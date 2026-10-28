# PDF Manager

Herramientas PDF que funcionan **100 % en el navegador**: ningún archivo se sube a un servidor. Sitio estático (GitHub Pages), sin backend y sin paso de compilación, que además funciona **sin conexión** tras la primera visita.

## Herramientas

| Categoría | Herramienta | Qué hace |
|---|---|---|
| Organizar | **Unir PDFs** | Ordena arrastrando (ratón o táctil), elige páginas de cada archivo, crea un marcador por archivo, página en blanco para dúplex y elimina recursos duplicados. |
| | **Dividir PDF** | Por rangos (`1-3, 8-`), cada N páginas, extrayendo páginas desde las miniaturas o **por marcadores**. |
| | **Organizar páginas** | Reordena, gira, duplica, elimina, inserta páginas en blanco o **de otros PDFs**. Deshacer/rehacer (`Ctrl+Z`/`Ctrl+Y`) y teclado (`Alt`+flechas). |
| | **Rotar PDF** | Páginas sueltas, pares, impares o todas, sin pérdida. |
| Optimizar | **Comprimir PDF** | Recomprime las imágenes incrustadas **manteniendo el texto vectorial**; modo sin pérdida (limpieza estructural) y modo rasterizado para escaneos. |
| Convertir | **PDF a imagen** *(nuevo)* | PNG, JPG o WebP a la resolución que elijas; varias páginas en ZIP. |
| | **Imágenes a PDF** *(nuevo)* | JPG, PNG, WebP, GIF, BMP, AVIF. Los JPG se incrustan sin recomprimir y se respeta la orientación EXIF. |
| | **Extraer texto** *(nuevo)* | Texto página a página a `.txt`, con detección de documentos escaneados. |
| Editar | **Marca de agua** | Texto o imagen, 9 posiciones o mosaico, encima/debajo del contenido, páginas a elegir y **vista previa real** (renderizada con PDF.js). |
| | **Numerar páginas** *(nuevo)* | Plantillas (`Página {n} de {total}`, `{fecha}`, `{archivo}`), posición, primer número, saltar portada y modo dúplex. |
| | **Firmar PDF** *(nuevo)* | Dibuja, escribe o sube tu firma (quitando el fondo) y colócala arrastrando. Avisa si el PDF ya tiene firmas digitales. |
| | **Editar metadatos** *(nuevo)* | Título, autor, fechas, idioma, XMP y ficha técnica; o eliminarlo todo y renovar el `/ID`. |
| Seguridad | **Proteger PDF** | Cifrado **AES-256 real** (o AES-128), permisos de impresión/copia/edición y contraseña de propietario aleatoria. |
| | **Desbloquear PDF** | Quita contraseña o restricciones y muestra algoritmo, revisión y permisos. |
| | **Analizar y sanear** *(nuevo)* | Triaje de seguridad: JavaScript, acciones automáticas, `Launch`, adjuntos ejecutables, enlaces sospechosos (IP, punycode, `http`), nombres ofuscados (`/J#61vaScript`), datos fuera de la estructura (políglotas), actualizaciones incrementales… Informe Markdown/JSON con SHA-256/SHA-1, recuento estilo *pdfid* y saneado selectivo. |

Comunes a todas: arrastrar, seleccionar o **pegar** archivos (`Ctrl+V`), PDFs cifrados (se pide la contraseña), **«Continuar con…»** para pasar el resultado a otra herramienta sin descargarlo, tema claro/oscuro y diseño adaptado a móvil.

## Cambios de la versión 2 (revisión del código)

Fallos de la versión anterior, verificados con pruebas reales antes de corregirlos:

- **«Proteger PDF» no cifraba**: la `pdf-lib` estándar ignora las opciones de contraseña y el PDF salía en claro mientras la interfaz decía «¡PDF protegido!». Además, con «Permitir impresión» marcado lanzaba un `TypeError` (`PDFLib.PrintingAllowedValues` no existe).
- **«Desbloquear» nunca funcionaba**: la `pdf-lib` estándar no descifra y, como el error contiene «encrypt», mostraba «Contraseña incorrecta» incluso con la clave buena.
- **PDF.js 3.11.174 vulnerable a [CVE-2024-4367](https://github.com/advisories/GHSA-wgrm-67xf-hhpq)** (ejecución de JavaScript arbitrario al abrir un PDF malicioso). Actualizado a PDF.js 6.4 con `isEvalSupported: false` y `enableXfa: false`.
- **Cadena de suministro**: `pdf-lib` se cargaba de `unpkg.com/pdf-lib` **sin versión fijada ni SRI**. Ahora todas las librerías están vendorizadas con versión fijada (ver `assets/vendor/versions.json`, con hashes SHA-384 que comprueban los tests) y cada página declara una **CSP** que impide cargar código de terceros.
- **DOM-XSS**: en «Unir» el nombre del archivo se insertaba con `innerHTML`; un PDF llamado `<img src=x onerror=…>.pdf` (nombre válido en macOS/Linux) ejecutaba código en la página. Ahora todo dato externo se inserta como texto (y un test lo vigila).
- **Unir: arrastrar para reordenar no funcionaba** (la variable `dragSrc` era local a cada elemento) y el DnD de HTML5 no funciona en móviles. Sustituido por un componente con Pointer Events (ratón, lápiz y táctil, con auto-scroll y alternativa por teclado).
- **Comprimir (modo imagen) encogía las páginas** al 75–90 % de su tamaño físico y las rasterizaba a 54–72 ppp, perdiendo además el texto. Ahora se recomprimen solo las imágenes y el texto sigue siendo vectorial.
- **Marca de agua**: la vista previa no coincidía con el resultado (otra fuente y otras métricas) y no respetaba páginas giradas (`/Rotate`) ni el `CropBox`. Ahora la vista previa es el PDF real renderizado.
- El workflow `deploy.yml` escuchaba la rama `main`, que no existe; solo desplegaba `static.yml`, que publicaba el repositorio entero.
- Rendimiento: al cargar se renderizaban todas las miniaturas de golpe (bloqueante con PDFs grandes) y cada vista volvía a parsear el PDF. Ahora se parsea una vez y solo se renderizan las miniaturas visibles, con concurrencia limitada.

Además, durante el desarrollo aparecieron dos comportamientos de `@cantoo/pdf-lib` que se corrigen en `assets/js/core/pdf-engine.js` y `pdf-objects.js`: al descifrar conservaba el antiguo stream XRef con `/Encrypt` (el resultado se detectaba otra vez como cifrado) y escribe en el archivo **todos** los objetos aunque nadie los referencie (al «borrar» metadatos o JavaScript, seguían dentro del PDF).

## Desarrollo

Requisitos: Node.js 20 o superior.

```bash
npm install          # dependencias de desarrollo (pdf-lib, PDF.js, Playwright)
npm run serve        # http://localhost:8080
npm test             # tests unitarios + E2E (genera los PDFs de prueba)
```

- **Sin compilación**: el sitio son ES modules servidos tal cual. Lo que se publica es exactamente lo que hay en el repositorio.
- **Actualizar librerías**: cambia la versión en `package.json`, `npm install` y `npm run vendor` (copia a `assets/vendor/`, recalcula hashes y regenera `sw.js`).
- **Service worker**: `sw.js` se genera con `npm run sw`; un test falla si está desfasado.
- **Tests**: `tests/unit` (Node) y `tests/e2e` (Playwright + Chromium). Los PDFs de prueba —incluidos uno cifrado y uno «sospechoso» inofensivo para el analizador— los crea `tests/fixtures/make-fixtures.mjs`. Los resultados se comprueban con pdf-lib y, si está instalado, con `qpdf`.
- **CI**: `.github/workflows/ci.yml` ejecuta los tests en cada push/PR y despliega en GitHub Pages desde `master` publicando solo los archivos del sitio.

### Estructura

```
index.html, 404.html, sw.js, manifest.webmanifest
tools/*.html                 Una página por herramienta
assets/css/                  base (variables y tema), components, layout
assets/js/core/              Núcleo compartido
  app.js                     Cabecera, pie, tema, service worker
  registry.js                Catálogo de herramientas (portada, menús, «Continuar con…»)
  pdf-engine.js              Carga/guardado y gestión de PDFs cifrados
  render.js                  PDF.js: miniaturas diferidas con cola limitada
  page-grid.js, sortable.js  Rejilla de páginas accesible y reordenación táctil
  geometry.js, stamp.js      Dibujo en coordenadas visuales (respeta /Rotate y CropBox)
  optimize.js                Compresión de imágenes y limpieza estructural
  pdf-analyzer.js            Análisis de seguridad y saneado
  pdf-objects.js             Objetos huérfanos, deduplicación, marcadores
  ranges.js, zip.js, password.js, images.js, …
assets/js/tools/*.js         Lógica de cada herramienta
assets/vendor/               Librerías con versión fijada (no editar a mano)
```

### Añadir una herramienta

1. Añádela a `TOOLS` en `assets/js/core/registry.js`.
2. Crea `tools/<id>.html` (copia la cabecera de otra página: CSP, estilos, `data-tool="<id>"`) y `assets/js/tools/<id>.js` importando `../core/app.js`.
3. Para herramientas de un solo PDF usa `singlePdfTool()`, `runTask()` y `createResultArea()` de `core/tool.js`.
4. Añade un test E2E y ejecuta `npm run sw`.

## Privacidad y seguridad

- El procesamiento ocurre en el navegador; el «traspaso» entre herramientas usa IndexedDB local y caduca a los 10 minutos.
- Los permisos de un PDF (impresión, copia…) los respetan los visores, pero **no son una protección criptográfica**; solo la contraseña de apertura cifra el contenido.
- La firma de «Firmar PDF» es **visual**: no sustituye a una firma electrónica con certificado.
- «Analizar y sanear» hace un análisis estático local: ayuda a decidir si un PDF es de fiar, pero no sustituye a un antivirus ni a un análisis en entorno aislado.

## Licencias de terceros

- [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (MIT) — fork de pdf-lib con cifrado y descifrado.
- [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0).

Sus licencias se incluyen en `assets/vendor/`.
