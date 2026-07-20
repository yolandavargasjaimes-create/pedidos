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

/** Carrito de compras en memoria, con persistencia opcional en localStorage. */
class Cart {
  #lines = new Map(); // itemId -> { item, qty }

  constructor(items = []) {
    for (const { item, qty } of items) this.#lines.set(item.id, { item, qty });
  }

  add(item, delta = 1) {
    const current = this.#lines.get(item.id)?.qty ?? 0;
    const nextQty = Math.max(0, current + delta);

    if (nextQty === 0) {
      this.#lines.delete(item.id);
    } else {
      this.#lines.set(item.id, { item, qty: nextQty });
    }
    this.#persist();
  }

  remove(itemId) {
    this.#lines.delete(itemId);
    this.#persist();
  }

  clear() {
    this.#lines.clear();
    this.#persist();
  }

  qtyFor(itemId) {
    return this.#lines.get(itemId)?.qty ?? 0;
  }

  get lines() {
    return [...this.#lines.values()];
  }

  get count() {
    return this.lines.reduce((sum, { qty }) => sum + qty, 0);
  }

  get total() {
    return this.lines.reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }

  #persist() {
    const serializable = this.lines.map(({ item, qty }) => ({ id: item.id, qty }));
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(serializable));
  }

  static restore(catalog) {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return new Cart();

    try {
      const saved = JSON.parse(raw);
      const items = saved
        .map(({ id, qty }) => ({ item: catalog.get(id), qty }))
        .filter(({ item }) => item != null);
      return new Cart(items);
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

  const itemLines = cart.lines.map(({ item, qty }) => {
    const subtotal = currency.format(item.price * qty);
    return `• ${qty} x ${item.name} — ${subtotal}`;
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

  node.querySelector(".item-name").textContent = item.name;
  node.querySelector(".item-desc").textContent = item.description ?? "";
  node.querySelector(".item-badge").textContent = item.badge ?? "";
  node.querySelector(".item-price").textContent = currency.format(item.price);

  const img = node.querySelector(".item-img");
  if (item.image) {
    img.src = item.image;
    img.alt = item.name;
    img.addEventListener("error", () => { img.dataset.broken = "true"; }, { once: true });
  } else {
    img.dataset.broken = "true";
  }

  const qtyValue = node.querySelector(".qty-value");
  const syncQty = () => {
    const qty = qtyFor(item.id);
    qtyValue.textContent = String(qty);
    qtyValue.dataset.zero = qty === 0 ? "true" : "false";
  };
  syncQty();

  node.querySelector(".qty-minus").addEventListener("click", () => {
    onQtyChange(item, -1);
    syncQty();
  });
  node.querySelector(".qty-plus").addEventListener("click", () => {
    onQtyChange(item, 1);
    syncQty();
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
    .map(
      ({ item, qty }) => `
      <li class="cart-line" data-item-id="${item.id}">
        <div>
          <div class="cart-line-name">${item.name}</div>
          <div class="cart-line-meta">
            <span>${qty} x ${currency.format(item.price)}</span>
            <button class="cart-line-remove" type="button" data-remove="${item.id}">quitar</button>
          </div>
        </div>
        <span class="cart-line-price">${currency.format(item.price * qty)}</span>
      </li>`
    )
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
    renderMenu(categories, { onQtyChange: handleQtyChange, qtyFor: (id) => cart.qtyFor(id) });
    renderCart(cart);
  };

  function handleQtyChange(item, delta) {
    cart.add(item, delta);
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
    cart.remove(removeId);
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
