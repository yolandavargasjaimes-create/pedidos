# Chespirito Burger's — Pedidos por WhatsApp

App estática (sin backend, sin base de datos) para que el cliente arme su pedido
y lo envíe directo a tu WhatsApp. No guarda ningún dato del cliente en ningún
servidor: el mensaje se genera en el propio navegador y se abre en `wa.me`.

## Estructura

```
chespirito-burgers/
├── index.html          # Estructura de la página
├── css/style.css        # Estilos (negro/rojo, tema "tiquete de pedido")
├── js/app.js             # Lógica: carrito, render, mensaje de WhatsApp
├── data/menu.json        # Menú completo — edítalo aquí, no en el código
└── README.md
```

## Personalizar

- **Número de WhatsApp:** en `data/menu.json`, campo `restaurant.phone`.
  Debe ir en formato internacional sin `+` ni espacios (ej. `573134304522`
  para Colombia: `57` + el número).
- **Productos y precios:** también en `data/menu.json`. Cada categoría tiene
  una lista de `items` con `id`, `name`, `price`, `description` y, opcional,
  `badge` (para una etiqueta tipo "Especial").
- **Colores:** variables CSS al inicio de `css/style.css` (`--red`, `--gold`,
  `--black`, etc).

El carrito recuerda la selección del cliente en su propio navegador
(`localStorage`) mientras arma el pedido; si prefieres que no persista nada
entre visitas, borra las llamadas a `localStorage` en `js/app.js`
(`Cart.restore` y el método privado `#persist`).

## Cómo funciona el envío

Al presionar "Enviar pedido por WhatsApp", la app arma un texto con los
productos, cantidades y total, y abre:

```
https://wa.me/<numero>?text=<mensaje-codificado>
```

Eso abre WhatsApp (app o web) con el mensaje ya escrito, listo para que el
cliente le dé enviar. Nada pasa por un servidor tuyo.

## Agregar fotos a los productos

Cada producto en `data/menu.json` tiene un campo `image` con la ruta relativa
al archivo, por ejemplo:

```json
{
  "id": "h-sencilla",
  "name": "Sencilla",
  "price": 13000,
  "description": "...",
  "image": "assets/images/h-sencilla.jpg"
}
```

Para que se vean, solo tienes que:

1. Poner tus fotos dentro de `assets/images/`.
2. Nombrar cada archivo **exactamente igual al `id` del producto** (así ya
   quedó pre-configurado para los 22 productos del menú actual: `h-sencilla.jpg`,
   `h-mixta.jpg`, `e-campeona.jpg`, `p-sencillo.jpg`, etc — revisa el `id` de
   cada item en `menu.json`).
3. Si usas otro formato (`.png`, `.webp`) o quieres otro nombre, solo edita el
   valor de `image` de ese producto en `menu.json` para que apunte al archivo
   correcto — no hay que tocar el código.

Si un producto no tiene foto todavía, o el archivo no existe, la tarjeta
muestra automáticamente un ícono de placeholder (🍔) en vez de romperse o
dejar un espacio en blanco raro.

**Recomendaciones para las fotos:**
- Formato cuadrado (1:1), por ejemplo 400x400px — la tarjeta las recorta a
  cuadrado (`object-fit: cover`), así que si no son cuadradas puede que se
  corte parte de la imagen.
- Comprime antes de subir (apunta a <150KB por foto) para que cargue rápido
  en celular. Herramientas gratis: [squoosh.app](https://squoosh.app) o
  [tinypng.com](https://tinypng.com).
- `.jpg` o `.webp` funcionan mejor que `.png` para fotos de comida (menos
  peso). `.webp` es el más moderno y liviano si quieres ir por ahí.

## Imprimir el pedido en una impresora térmica 80mm (Bluetooth)

Sí es posible, pero con una limitación técnica real que vale la pena
entender antes de configurar nada:

**Por qué no se conecta "directo" desde el navegador:** la mayoría de
impresoras térmicas 80mm baratas usan Bluetooth *Clásico* (perfil SPP), y
los navegadores solo pueden hablar Bluetooth mediante la *Web Bluetooth API*,
que únicamente soporta dispositivos *BLE*. Además, Web Bluetooth **no existe
en Safari/iOS** — solo funciona en Chrome/Edge de Android. Por eso una
conexión directa navegador → impresora casi nunca funciona con este tipo de
hardware.

**La solución que quedó integrada (solo Android, gratis):** la app
[RawBT](https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter)
actúa de puente. Ella sí sabe hablar Bluetooth Clásico con la impresora; nuestra
página solo arma el ticket en formato ESC/POS (el lenguaje que entienden estas
impresoras: negrita, centrado, corte de papel) y se lo pasa a RawBT mediante
un enlace especial (`intent:`) que Android reconoce.

### Configuración (una sola vez, en el celular del negocio)

1. Empareja la impresora por Bluetooth normalmente, en **Ajustes del celular**
   (como cualquier otro dispositivo Bluetooth).
2. Instala **RawBT** desde Play Store (versión gratuita es suficiente).
3. Abre RawBT una vez y selecciona tu impresora en su configuración, para que
   quede como la impresora activa.
4. Listo. Desde ese momento, el botón **🖨️ Imprimir** que aparece en el
   carrito (solo visible en Android) manda el ticket directo a la impresora.

### Qué pasa si RawBT no está instalado

Si el celular no tiene RawBT, el enlace `intent:` que genera la app abre
automáticamente la página de RawBT en Play Store — no da un error silencioso.

### Dónde está el código

- `js/receipt.js` — arma el ticket en bytes ESC/POS (`ReceiptBuilder`) y lo
  envía a RawBT (`printViaRawBT`). Aquí se controla el ancho en columnas
  (`PRINTER_WIDTH_CHARS`, 48 por defecto para 80mm) y el formato del ticket
  (encabezado, items, total, corte de papel).
- `js/app.js` — muestra el botón de imprimir solo si detecta Android
  (`isAndroid()`), y lo conecta con `buildOrderReceipt`.

### ¿Y si la impresora está en la red local (WiFi) en vez de Bluetooth?

También funciona, sin tocar el código. Un dato importante primero: no es
posible que el navegador le hable directo a la IP local de la impresora
(puerto 9100, protocolo AppSocket), por dos razones: los navegadores no
abren conexiones TCP crudas desde JavaScript, y además tu sitio está en
HTTPS (GitHub Pages) mientras que la impresora solo habla HTTP/TCP plano en
su IP local — eso es "mixed content" y el navegador lo bloquea.

La buena noticia es que RawBT ya soporta esto de fábrica: además de
Bluetooth, RawBT puede conectarse a impresoras por **WiFi/Ethernet
(puerto 9100)**. El cambio es solo de configuración, en el celular:

1. Abre RawBT → configuración de la impresora.
2. Cambia el tipo de conexión de Bluetooth a **WiFi/Ethernet**.
3. Ingresa la IP local de la impresora (idealmente fija/reservada en el
   router) y el puerto `9100`.

El botón 🖨️ Imprimir de esta app no cambia en nada — siempre le habla a
RawBT, y es RawBT quien decide si entrega el ticket por Bluetooth o por
WiFi según cómo la tengas configurada.

### Sobre tildes y eñes

Las impresoras térmicas económicas casi siempre usan una codificación de
un solo byte que no siempre coincide con UTF-8, así que las tildes pueden
salir como símbolos raros. Para evitarlo, `receipt.js` quita acentos antes de
imprimir (`Perro sencillo`, `Cebolla`, `Porción` → `Porcion`, etc). Si tu
impresora sí soporta bien los acentos, puedes quitar esa normalización en la
función `toPrinterSafeText`.

### Si en el futuro necesitas soporte en iPhone

Esto **no es posible desde una página web normal en iOS** (Apple no da acceso
a Bluetooth Clásico desde Safari, y no hay un "RawBT" equivalente instalable
libremente). La única forma real sería empaquetar esta misma app dentro de
un contenedor nativo (por ejemplo con Capacitor) usando un plugin de
impresión Bluetooth nativo — es un proyecto aparte, bastante más grande que
esto.

## Cómo probarlo localmente

Como usa `fetch()` para cargar `menu.json`, no puedes simplemente abrir
`index.html` con doble clic (los navegadores bloquean `fetch` sobre `file://`).
Levanta un servidor local simple:

```bash
# con Python
python3 -m http.server 8000

# o con Node
npx serve .
```

Y abre `http://localhost:8000`.

## Dónde alojarlo gratis

Cualquiera de estas opciones sirve, son 100% gratis para un sitio estático
como este:

### Opción A — GitHub Pages (recomendada, ya que mencionaste GitHub)
1. Crea un repositorio nuevo en GitHub y sube esta carpeta (o su contenido).
2. Ve a **Settings → Pages**.
3. En "Source" elige la rama `main` y la carpeta `/root`.
4. Guarda. En un par de minutos tu sitio queda en
   `https://tu-usuario.github.io/tu-repo/`.
5. Cada vez que hagas `git push` con cambios, el sitio se actualiza solo.

### Opción B — Netlify (la más rápida para empezar)
1. Entra a [app.netlify.com](https://app.netlify.com) y crea una cuenta gratis.
2. Arrastra la carpeta `chespirito-burgers` completa a la zona de "Deploy".
3. Netlify te da una URL al instante (puedes cambiarle el subdominio).

### Opción C — Vercel
1. Entra a [vercel.com](https://vercel.com), conecta tu cuenta de GitHub.
2. Importa el repositorio (mismo repo de la Opción A funciona).
3. Deploy automático, sin configuración adicional (es un sitio estático).

Las tres opciones incluyen HTTPS gratis, que es importante porque
WhatsApp Web/`wa.me` funciona mejor desde sitios servidos por HTTPS.

## Notas de privacidad

- No hay base de datos, no hay backend, no hay analítica ni cookies.
- El nombre/nota que el cliente escribe solo viaja dentro del mensaje de
  WhatsApp que él mismo envía; la app no lo transmite ni almacena en
  ningún otro lugar.
