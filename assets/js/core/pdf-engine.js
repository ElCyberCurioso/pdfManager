/* ============================================================
   PDF ENGINE — pdf-lib bootstrap, loadPDF / savePDF wrappers
   ============================================================ */

const PDFEngine = (() => {
  async function load(arrayBuffer, options = {}) {
    return await PDFLib.PDFDocument.load(arrayBuffer, {
      ignoreEncryption: false,
      ...options,
    });
  }

  async function loadWithPassword(arrayBuffer, password) {
    return await PDFLib.PDFDocument.load(arrayBuffer, { password });
  }

  async function save(pdfDoc, options = {}) {
    return await pdfDoc.save(options);
  }

  async function create() {
    return await PDFLib.PDFDocument.create();
  }

  // Read a File object → ArrayBuffer (cached on the File object itself)
  function fileToBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Error al leer el archivo.'));
      reader.readAsArrayBuffer(file);
    });
  }

  // Shallow copy of an ArrayBuffer (safe to pass to multiple pdf-lib loads)
  function cloneBuffer(buf) {
    return buf.slice(0);
  }

  return { load, loadWithPassword, save, create, fileToBuffer, cloneBuffer };
})();
