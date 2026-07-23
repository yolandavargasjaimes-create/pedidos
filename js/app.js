// ============================================================
// Chespirito Burger's — Carrito de pedidos sin backend
// Todo vive en el navegador. Nada se guarda en ningún servidor.
// ============================================================

import { buildOrderReceipt, printViaRawBT, isAndroid } from "./receipt.js";

const MENU_URL = "./data/menu.json";
const CART_STORAGE_KEY = "chespirito:cart";

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Devuelve las variantes de tamaño de un producto, o `null` si tiene precio único. */
const sizesOf = (item) => (item.sizes?.length ? item.sizes : null);

/** Resuelve la variante de tamaño elegida (o la primera por defecto). */
const resolveSize = (item, sizeId) => {
  const sizes = sizesOf(item);
  if (!sizes) return null;
  return sizes.find((size) => size.id === sizeId) ?? sizes[0];
};

/** Precio unitario vigente para un producto + tamaño (o su precio fijo). */
const unitPriceOf = (item, size) => size?.price ?? item.price;

/** Clave única de línea de carrito: un mismo producto en tamaños distintos son líneas distintas. */
const lineKey = (itemId, sizeId) => (sizeId ? `${itemId}::${sizeId}` : itemId);

/** Carrito de compras en memoria, con persistencia opcional en localStorage. */
class Cart {
  #lines = new Map(); // "itemId" | "itemId::sizeId" -> { item, size, qty }

  constructor(entries = []) {
    for (const { item, size, qty } of entries) {
      this.#lines.set(lineKey(item.id, size?.id), { item, size, qty });
    }
  }

  add(item, delta = 1, sizeId = null) {
    const size = sizeId ? resolveSize(item, sizeId) : null;
    const key = lineKey(item.id, size?.id);
    const current = this.#lines.get(key)?.qty ?? 0;
    const nextQty = Math.max(0, current + delta);

    if (nextQty === 0) {
      this.#lines.delete(key);
    } else {
      this.#lines.set(key, { item, size, qty: nextQty });
    }
    this.#persist();
  }

  remove(itemId, sizeId = null) {
    this.#lines.delete(lineKey(itemId, sizeId));
    this.#persist();
  }

  clear() {
    this.#lines.clear();
    this.#persist();
  }

  qtyFor(itemId, sizeId = null) {
    return this.#lines.get(lineKey(itemId, sizeId))?.qty ?? 0;
  }

  get lines() {
    return [...this.#lines.values()].map(({ item, size, qty }) => ({
      item,
      size,
      qty,
      unitPrice: unitPriceOf(item, size),
    }));
  }

  get count() {
    return this.lines.reduce((sum, { qty }) => sum + qty, 0);
  }

  get total() {
    return this.lines.reduce((sum, { unitPrice, qty }) => sum + unitPrice * qty, 0);
  }

  #persist() {
    const serializable = [...this.#lines.values()].map(({ item, size, qty }) => ({
      id: item.id,
      sizeId: size?.id ?? null,
      qty,
    }));
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(serializable));
  }

  static restore(catalog) {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return new Cart();

    try {
      const saved = JSON.parse(raw);
      const entries = saved
        .map(({ id, sizeId, qty }) => {
          const item = catalog.get(id);
          if (!item) return null;
          const size = sizeId ? resolveSize(item, sizeId) : null;
          return { item, size, qty };
        })
        .filter((entry) => entry != null);
      return new Cart(entries);
    } catch {
      return new Cart();
    }
  }
}

/** Arma el texto del pedido y el link de WhatsApp. */
const buildWhatsAppMessage = ({ cart, customerName, customerNote, restaurantName }) => {
  const header = `*Pedido — ${restaurantName}*`;
  const nameLine = customerName ? `👤 Nombre: ${customerName}` : null;
  const noteLine = customerNote ? `📍 Nota: ${customerNote}` : null;

  const itemLines = cart.lines.map(({ item, size, qty, unitPrice }) => {
    const subtotal = currency.format(unitPrice * qty);
    const label = size ? `${item.name} (${size.label})` : item.name;
    return `• ${qty} x ${label} — ${subtotal}`;
  });

  const totalLine = `*Total: ${currency.format(cart.total)}*`;

  return [header, nameLine, noteLine, "", ...itemLines, "", totalLine]
    .filter((line) => line !== null)
    .join("\n");
};

const buildWhatsAppUrl = (phone, message) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------

const els = {
  nav: document.getElementById("cat-nav"),
  root: document.getElementById("menu-root"),
  loading: document.getElementById("loading-msg"),
  template: document.getElementById("item-card-template"),

  fab: document.getElementById("cart-fab"),
  fabCount: document.getElementById("cart-fab-count"),
  headerCartBtn: document.getElementById("header-cart-btn"),
  headerCartCount: document.getElementById("header-cart-count"),

  overlay: document.getElementById("cart-overlay"),
  drawer: document.getElementById("cart-drawer"),
  closeBtn: document.getElementById("cart-close"),

  cartItems: document.getElementById("cart-items"),
  cartEmpty: document.getElementById("cart-empty"),
  cartTotal: document.getElementById("cart-total-value"),
  clearBtn: document.getElementById("cart-clear"),
  printBtn: document.getElementById("cart-print"),
  printHint: document.getElementById("print-hint"),
  sendBtn: document.getElementById("cart-send"),

  nameInput: document.getElementById("customer-name"),
  noteInput: document.getElementById("customer-note"),
};

const renderCategoryNav = (categories) => {
  els.nav.innerHTML = categories
    .map(({ id, name }) => `<a class="cat-pill" href="#cat-${id}">${name}</a>`)
    .join("");
};

const renderMenu = (categories, { onQtyChange, qtyFor }) => {
  els.root.innerHTML = "";

  for (const category of categories) {
    const section = document.createElement("section");
    section.className = "menu-section";
    section.id = `cat-${category.id}`;

    const title = document.createElement("h2");
    title.className = "menu-section-title";
    title.textContent = category.name;
    section.append(title);

    const grid = document.createElement("div");
    grid.className = "item-grid";

    for (const item of category.items) {
      grid.append(renderItemCard(item, { onQtyChange, qtyFor }));
    }

    section.append(grid);
    els.root.append(section);
  }
};

const renderItemCard = (item, { onQtyChange, qtyFor }) => {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const sizes = sizesOf(item);

  node.querySelector(".item-name").textContent = item.name;
  node.querySelector(".item-desc").textContent = item.description ?? "";
  node.querySelector(".item-badge").textContent = item.badge ?? "";

  const img = node.querySelector(".item-img");
  if (item.image) {
    img.src = item.image;
    img.alt = item.name;
    img.addEventListener("error", () => { img.dataset.broken = "true"; }, { once: true });
  } else {
    img.dataset.broken = "true";
  }

  const priceEl = node.querySelector(".item-price");
  const qtyValue = node.querySelector(".qty-value");
  const pillsEl = node.querySelector(".size-pills");

  // Tamaño activo de la tarjeta (solo aplica a productos con variantes, p. ej. pizzas).
  let activeSizeId = sizes?.[0]?.id ?? null;

  const syncDisplay = () => {
    const activeSize = sizes ? resolveSize(item, activeSizeId) : null;
    priceEl.textContent = currency.format(unitPriceOf(item, activeSize));

    const qty = qtyFor(item.id, activeSize?.id ?? null);
    qtyValue.textContent = String(qty);
    qtyValue.dataset.zero = qty === 0 ? "true" : "false";

    if (sizes) {
      pillsEl.querySelectorAll(".size-pill").forEach((pill) => {
        pill.classList.toggle("is-active", pill.dataset.sizeId === activeSize?.id);
        pill.setAttribute("aria-checked", String(pill.dataset.sizeId === activeSize?.id));
      });
    }
  };

  if (sizes) {
    pillsEl.hidden = false;
    pillsEl.innerHTML = sizes
      .map(
        (size) => `
        <button type="button" class="size-pill" role="radio" data-size-id="${size.id}">
          ${size.label}
        </button>`
      )
      .join("");

    pillsEl.addEventListener("click", (event) => {
      const pill = event.target.closest(".size-pill");
      if (!pill) return;
      activeSizeId = pill.dataset.sizeId;
      syncDisplay();
    });
  }

  syncDisplay();

  node.querySelector(".qty-minus").addEventListener("click", () => {
    onQtyChange(item, -1, activeSizeId);
    syncDisplay();
  });
  node.querySelector(".qty-plus").addEventListener("click", () => {
    onQtyChange(item, 1, activeSizeId);
    syncDisplay();
  });

  node.dataset.itemId = item.id;
  return node;
};

const renderCart = (cart) => {
  const countStr = String(cart.count);
  els.fabCount.textContent = countStr;
  els.headerCartCount.textContent = countStr;
  els.cartTotal.textContent = currency.format(cart.total);
  els.sendBtn.disabled = cart.count === 0;
  els.printBtn.disabled = cart.count === 0;
  els.cartEmpty.hidden = cart.count > 0;

  els.cartItems.innerHTML = cart.lines
    .map(({ item, size, qty, unitPrice }) => {
      const name = size ? `${item.name} <span class="cart-line-size">(${size.label})</span>` : item.name;
      return `
      <li class="cart-line" data-item-id="${item.id}" data-size-id="${size?.id ?? ""}">
        <div>
          <div class="cart-line-name">${name}</div>
          <div class="cart-line-meta">
            <span>${qty} x ${currency.format(unitPrice)}</span>
            <button class="cart-line-remove" type="button" data-remove="${item.id}" data-size="${size?.id ?? ""}">quitar</button>
          </div>
        </div>
        <span class="cart-line-price">${currency.format(unitPrice * qty)}</span>
      </li>`;
    })
    .join("");
};

// ------------------------------------------------------------
// Wiring
// ------------------------------------------------------------

const openCart = () => {
  els.drawer.classList.add("is-open");
  els.overlay.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.fab.setAttribute("aria-expanded", "true");
  els.headerCartBtn.setAttribute("aria-expanded", "true");
};

const closeCart = () => {
  els.drawer.classList.remove("is-open");
  els.overlay.classList.remove("is-open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.fab.setAttribute("aria-expanded", "false");
  els.headerCartBtn.setAttribute("aria-expanded", "false");
};

const init = async () => {
  let menu;
  try {
    const response = await fetch(MENU_URL);
    if (!response.ok) throw new Error(`No se pudo cargar el menú (${response.status})`);
    menu = await response.json();
  } catch (error) {
    els.loading.textContent = "No se pudo cargar el menú. Intenta recargar la página.";
    console.error(error);
    return;
  }

  const { restaurant, categories } = menu;
  const catalog = new Map(
    categories.flatMap(({ items }) => items.map((item) => [item.id, item]))
  );

  const cart = Cart.restore(catalog);

  const refresh = () => {
    renderMenu(categories, {
      onQtyChange: handleQtyChange,
      qtyFor: (id, sizeId) => cart.qtyFor(id, sizeId),
    });
    renderCart(cart);
  };

  function handleQtyChange(item, delta, sizeId) {
    cart.add(item, delta, sizeId);
    renderCart(cart);
  }

  els.loading.remove();
  renderCategoryNav(categories);
  refresh();

  if (isAndroid()) {
    els.printBtn.hidden = false;
    els.printHint.hidden = false;
  }

  els.fab.addEventListener("click", openCart);
  els.headerCartBtn.addEventListener("click", openCart);
  els.closeBtn.addEventListener("click", closeCart);
  els.overlay.addEventListener("click", closeCart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCart();
  });

  els.cartItems.addEventListener("click", (event) => {
    const removeId = event.target?.dataset?.remove;
    if (!removeId) return;
    const sizeId = event.target.dataset.size || null;
    cart.remove(removeId, sizeId);
    refresh();
  });

  els.clearBtn.addEventListener("click", () => {
    if (cart.count === 0) return;
    const confirmed = confirm("¿Vaciar todo el pedido?");
    if (!confirmed) return;
    cart.clear();
    refresh();
  });

  els.printBtn.addEventListener("click", () => {
    if (cart.count === 0) return;

    const base64Ticket = buildOrderReceipt({
      cart,
      restaurantName: restaurant.name,
      customerName: els.nameInput.value.trim(),
      customerNote: els.noteInput.value.trim(),
    });

    printViaRawBT(base64Ticket);
  });

  els.sendBtn.addEventListener("click", () => {
    if (cart.count === 0) return;

    const message = buildWhatsAppMessage({
      cart,
      customerName: els.nameInput.value.trim(),
      customerNote: els.noteInput.value.trim(),
      restaurantName: restaurant.name,
    });

    const url = buildWhatsAppUrl(restaurant.phone, message);
    window.open(url, "_blank", "noopener,noreferrer");
  });
};

init();
