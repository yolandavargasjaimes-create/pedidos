// ============================================================
// Recibo ESC/POS para impresoras térmicas 80mm por Bluetooth
//
// Estrategia: la Web Bluetooth API no sirve aquí porque la mayoría
// de impresoras térmicas usan Bluetooth Clásico (perfil SPP), y
// además Safari/iOS no implementa Web Bluetooth en absoluto.
//
// En vez de eso delegamos el envío por Bluetooth a RawBT, una app
// Android gratuita que ya sabe hablar con estas impresoras. Nuestro
// trabajo es solo construir los bytes ESC/POS del ticket y pasárselos
// mediante un intent de Android. Doc: https://rawbt.ru/start.html
// ============================================================

const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";

// Ajusta esto si tus líneas quedan muy cortas o se desbordan:
// 80mm suele ser 48 columnas con fuente normal, 32 si tu impresora
// usa fuente ancha por defecto.
const PRINTER_WIDTH_CHARS = 48;

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  doubleOn: [GS, 0x21, 0x11],
  doubleOff: [GS, 0x21, 0x00],
  feed: (lines = 1) => [ESC, 0x64, lines],
  cut: [GS, 0x56, 0x00],
};

/**
 * Quita tildes/eñes especiales que suelen imprimirse mal en la
 * codificación por defecto de las impresoras térmicas económicas.
 * Si tu impresora sí soporta CP1252/UTF-8 correctamente, puedes
 * omitir esta función y usar el texto tal cual.
 */
const toPrinterSafeText = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\xFF]/g, "?");

const textToBytes = (text) =>
  [...toPrinterSafeText(text)].map((char) => char.charCodeAt(0));

/** Constructor de tickets ESC/POS con una API en cadena (fluent). */
class ReceiptBuilder {
  #bytes = [];

  #push(values) {
    this.#bytes.push(...values.flat());
    return this;
  }

  init() { return this.#push(CMD.init); }
  center() { return this.#push(CMD.alignCenter); }
  left() { return this.#push(CMD.alignLeft); }
  bold(on = true) { return this.#push(on ? CMD.boldOn : CMD.boldOff); }
  big(on = true) { return this.#push(on ? CMD.doubleOn : CMD.doubleOff); }
  feed(lines = 1) { return this.#push(CMD.feed(lines)); }
  cut() { return this.#push(CMD.cut); }

  line(text = "") { return this.#push(textToBytes(`${text}\n`)); }

  /** Igual que line(), pero sin el salto final: útil para mezclar tamaños en una misma fila. */
  text(text = "") { return this.#push(textToBytes(text)); }

  rule(char = "-") { return this.line(char.repeat(PRINTER_WIDTH_CHARS)); }

  /** Línea de dos columnas: texto a la izquierda, valor a la derecha. */
  row(left, right) {
    const space = Math.max(1, PRINTER_WIDTH_CHARS - left.length - right.length);
    return this.line(`${left}${" ".repeat(space)}${right}`);
  }

  /**
   * Igual que row(), pero el texto de la izquierda sale en tamaño grande
   * (doble ancho/alto, como el título) y el valor de la derecha en tamaño
   * normal. El modo grande ocupa 2 columnas por carácter, así que el
   * padding se calcula con ese ancho para que el precio siga cuadrando
   * a la derecha.
   */
  rowBig(left, right) {
    const leftColumns = left.length * 2;
    const space = Math.max(1, PRINTER_WIDTH_CHARS - leftColumns - right.length);

    return this.big(true)
      .text(left)
      .big(false)
      .line(`${" ".repeat(space)}${right}`);
  }

  toBytes() { return Uint8Array.from(this.#bytes); }

  toBase64() {
    let binary = "";
    for (const byte of this.toBytes()) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

const currencyPlain = (value) => `$${value.toLocaleString("es-CO")}`;

/** Arma el ticket completo a partir del carrito y lo deja listo en base64. */
export const buildOrderReceipt = ({ cart, restaurantName, customerName, customerNote }) => {
  const now = new Date().toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });

  const receipt = new ReceiptBuilder().init();

  receipt.center().big(true).bold(true).line(restaurantName).big(false).bold(false);
  receipt.line(now);
  receipt.rule("=");

  if (customerName) receipt.left().line(`Cliente: ${customerName}`);
  if (customerNote) receipt.left().line(`Nota: ${customerNote}`);
  if (customerName || customerNote) receipt.rule("-");

  receipt.left();
  for (const { item, qty } of cart.lines) {
    receipt.bold(true).rowBig(`${qty} x ${item.name}`, currencyPlain(item.price * qty)).bold(false);
  }

  receipt.rule("-");
  receipt.bold(true).row("TOTAL", currencyPlain(cart.total)).bold(false);
  receipt.rule("=");
  receipt.center().line("Gracias por tu pedido");
  receipt.feed(3).cut();

  return receipt.toBase64();
};

/** Abre RawBT con el ticket ya codificado en base64. Solo funciona en Android. */
export const printViaRawBT = (base64Data) => {
  const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end;`;
  window.location.href = intentUrl;
};

export const isAndroid = () => /android/i.test(navigator.userAgent);
