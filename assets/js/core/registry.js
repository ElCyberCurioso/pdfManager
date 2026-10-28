/* ============================================================
   REGISTRY — Catálogo único de herramientas. Lo usan la portada,
   la cabecera, el pie y el menú "Continuar con…".
   ============================================================ */

/** URL raíz del sitio (funciona en GitHub Pages bajo /<repo>/). */
export const ROOT = new URL('../../../', import.meta.url);

export const CATEGORIES = [
  { id: 'organize', name: 'Organizar' },
  { id: 'optimize', name: 'Optimizar' },
  { id: 'convert',  name: 'Convertir' },
  { id: 'edit',     name: 'Editar' },
  { id: 'security', name: 'Seguridad y privacidad' },
];

/**
 * input: 'pdf' | 'image' — qué acepta la herramienta (para "Continuar con…").
 * keywords: términos extra para el buscador de la portada.
 */
export const TOOLS = [
  { id: 'merge',        file: 'merge.html',        icon: 'merge',     category: 'organize', input: 'pdf',
    title: 'Unir PDFs',            desc: 'Combina varios PDFs en uno, en el orden que prefieras.',               keywords: 'juntar combinar fusionar concatenar' },
  { id: 'split',        file: 'split.html',        icon: 'split',     category: 'organize', input: 'pdf',
    title: 'Dividir PDF',          desc: 'Separa por intervalos, rangos o extrae páginas concretas.',           keywords: 'separar extraer cortar partir' },
  { id: 'reorder',      file: 'reorder.html',      icon: 'organize',  category: 'organize', input: 'pdf',
    title: 'Organizar páginas',    desc: 'Reordena, gira, duplica, elimina e inserta páginas (incluso de otros PDFs).', keywords: 'reordenar ordenar eliminar borrar insertar duplicar blanco' },
  { id: 'rotate',       file: 'rotate.html',       icon: 'rotate',    category: 'organize', input: 'pdf',
    title: 'Rotar PDF',            desc: 'Gira páginas sueltas o el documento completo.',                       keywords: 'girar orientación horizontal vertical' },
  { id: 'compress',     file: 'compress.html',     icon: 'compress',  category: 'optimize', input: 'pdf',
    title: 'Comprimir PDF',        desc: 'Reduce el tamaño recomprimiendo imágenes sin perder el texto.',       keywords: 'reducir tamaño optimizar peso' },
  { id: 'pdf-to-image', isNew: true, file: 'pdf-to-image.html', icon: 'image',     category: 'convert',  input: 'pdf',
    title: 'PDF a imagen',         desc: 'Convierte páginas a PNG o JPG con la resolución que elijas.',         keywords: 'png jpg jpeg exportar convertir' },
  { id: 'image-to-pdf', isNew: true, file: 'image-to-pdf.html', icon: 'images',    category: 'convert',  input: 'image',
    title: 'Imágenes a PDF',       desc: 'Crea un PDF a partir de fotos JPG, PNG o WebP.',                      keywords: 'fotos escanear jpg png webp convertir' },
  { id: 'extract-text', isNew: true, file: 'extract-text.html', icon: 'text',      category: 'convert',  input: 'pdf',
    title: 'Extraer texto',        desc: 'Obtén el texto del PDF como .txt, página a página.',                  keywords: 'txt copiar texto convertir' },
  { id: 'watermark',    file: 'watermark.html',    icon: 'watermark', category: 'edit',     input: 'pdf',
    title: 'Marca de agua',        desc: 'Añade texto o un logo como marca de agua, con vista previa real.',    keywords: 'sello logo confidencial borrador' },
  { id: 'page-numbers', isNew: true, file: 'page-numbers.html', icon: 'hash',      category: 'edit',     input: 'pdf',
    title: 'Numerar páginas',      desc: 'Números, encabezados y pies de página personalizables.',             keywords: 'numeración paginar encabezado pie' },
  { id: 'sign', isNew: true,         file: 'sign.html',         icon: 'pen',       category: 'edit',     input: 'pdf',
    title: 'Firmar PDF',           desc: 'Dibuja, escribe o sube tu firma y colócala donde quieras.',           keywords: 'firma rúbrica firmar' },
  { id: 'metadata', isNew: true,     file: 'metadata.html',     icon: 'tag',       category: 'edit',     input: 'pdf',
    title: 'Editar metadatos',     desc: 'Consulta, edita o elimina título, autor, fechas y XMP.',               keywords: 'propiedades autor título xmp info' },
  { id: 'protect',      file: 'protect.html',      icon: 'lock',      category: 'security', input: 'pdf',
    title: 'Proteger PDF',         desc: 'Cifra con AES-256 y define permisos de impresión y copia.',          keywords: 'contraseña cifrar encriptar aes' },
  { id: 'unlock',       file: 'unlock.html',       icon: 'unlock',    category: 'security', input: 'pdf',
    title: 'Desbloquear PDF',      desc: 'Quita la contraseña o las restricciones si conoces la clave.',       keywords: 'contraseña descifrar quitar restricciones' },
  { id: 'inspect', isNew: true,      file: 'inspect.html',      icon: 'shield',    category: 'security', input: 'pdf',
    title: 'Analizar y sanear',    desc: 'Detecta JavaScript, enlaces, adjuntos y acciones; limpia el PDF.',    keywords: 'seguridad malware javascript analizar limpiar sanear adjuntos enlaces phishing' },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);

/** URL absoluta de una herramienta. */
export const toolUrl = (tool) => new URL(`tools/${tool.file}`, ROOT).href;
