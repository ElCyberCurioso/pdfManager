/* ============================================================
   FILE HANDLER — Drag-drop, file input, validation
   ============================================================ */

const FileHandler = (() => {
  const MAX_SIZE_MB = 200;

  function validate(file) {
    if (!file.type && !file.name.toLowerCase().endsWith('.pdf')) {
      return 'Solo se aceptan archivos PDF.';
    }
    if (file.type && file.type !== 'application/pdf') {
      return 'Solo se aceptan archivos PDF.';
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `El archivo supera el límite de ${MAX_SIZE_MB} MB.`;
    }
    return null;
  }

  /**
   * Init drag-and-drop on a drop zone element.
   *
   * @param {HTMLElement} zone      - The .drop-zone element
   * @param {HTMLInputElement} input - The hidden file input inside it
   * @param {Function} onFiles      - Callback(File[]) when valid files are chosen
   * @param {Object} opts
   *   @param {boolean} opts.multiple - Allow multiple files (default false)
   */
  function init(zone, input, onFiles, opts = {}) {
    const multiple = opts.multiple || false;

    // Click zone → open file picker
    zone.addEventListener('click', (e) => {
      if (e.target === input) return;
      input.click();
    });

    // File input change
    input.addEventListener('change', () => {
      handleFiles(Array.from(input.files));
      input.value = ''; // reset so same file can be re-selected
    });

    // Drag events
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    });

    function handleFiles(files) {
      if (!files.length) return;
      const valid = [];
      for (const file of files) {
        const err = validate(file);
        if (err) { UI.toast(err, 'error'); continue; }
        valid.push(file);
      }
      if (!valid.length) return;
      const chosen = multiple ? valid : [valid[0]];
      onFiles(chosen);
    }
  }

  return { init, validate };
})();
