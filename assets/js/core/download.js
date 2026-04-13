/* ============================================================
   DOWNLOAD — Blob → anchor download helper
   ============================================================ */

const Download = (() => {
  function save(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function saveZip(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Build output filename: prefix + original stem + suffix + .pdf
  function buildName(originalName, prefix = '', suffix = '') {
    const stem = originalName.replace(/\.pdf$/i, '');
    return `${prefix}${stem}${suffix}.pdf`;
  }

  return { save, saveZip, buildName };
})();
