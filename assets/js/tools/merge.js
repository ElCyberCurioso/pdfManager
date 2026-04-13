/* ============================================================
   MERGE TOOL
   ============================================================ */
(() => {
  const dropZone     = document.getElementById('dropZone');
  const fileInput    = document.getElementById('fileInput');
  const fileListWrap = document.getElementById('fileListWrap');
  const fileListEl   = document.getElementById('fileList');
  const fileCountEl  = document.getElementById('fileCount');
  const addMoreBtn   = document.getElementById('addMoreBtn');
  const addMoreInput = document.getElementById('addMoreInput');
  const clearAllBtn  = document.getElementById('clearAllBtn');
  const actionBar    = document.getElementById('actionBar');
  const mergeBtn     = document.getElementById('mergeBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');
  const progressLabel= document.getElementById('progressLabel');
  const resultArea   = document.getElementById('resultArea');
  const resultMeta   = document.getElementById('resultMeta');
  const downloadBtn  = document.getElementById('downloadBtn');
  const startOverBtn = document.getElementById('startOverBtn');

  // State
  let files = [];          // { file: File, buffer: ArrayBuffer, pages: number }
  let resultBytes = null;

  // Init drag-drop
  FileHandler.init(dropZone, fileInput, onFilesAdded, { multiple: true });

  // Add more
  addMoreBtn.addEventListener('click', () => addMoreInput.click());
  addMoreInput.addEventListener('change', () => {
    onFilesAdded(Array.from(addMoreInput.files));
    addMoreInput.value = '';
  });

  clearAllBtn.addEventListener('click', reset);
  mergeBtn.addEventListener('click', doMerge);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, 'merged.pdf');
  });

  async function onFilesAdded(newFiles) {
    for (const file of newFiles) {
      try {
        const buffer = await PDFEngine.fileToBuffer(file);
        const pages  = await Preview.getPageCount(buffer);
        files.push({ file, buffer, pages });
        await addFileItem(files.length - 1);
      } catch {
        UI.toast(`Error al leer "${file.name}"`, 'error');
      }
    }
    updateUI();
  }

  async function addFileItem(idx) {
    const { file, buffer, pages } = files[idx];

    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.idx = idx;
    item.draggable = true;

    // Thumbnail
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-item__thumb';
    const canvas = document.createElement('canvas');
    thumbWrap.appendChild(canvas);
    Preview.renderPage(buffer, 1, canvas, 40).catch(() => {});

    // Info
    const info = document.createElement('div');
    info.className = 'file-item__info';
    info.innerHTML = `
      <div class="file-item__name">${file.name}</div>
      <div class="file-item__meta">${pages} página${pages !== 1 ? 's' : ''} · ${UI.formatBytes(file.size)}</div>
    `;

    // Actions
    const actions = document.createElement('div');
    actions.className = 'file-item__actions';
    actions.innerHTML = `
      <button class="btn btn-ghost btn-icon btn-sm" data-action="up" title="Subir">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon btn-sm" data-action="down" title="Bajar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon btn-sm" data-action="remove" title="Eliminar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
      <span class="drag-handle" title="Arrastrar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </span>
    `;

    actions.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const i = getItemIndex(item);
      if (btn.dataset.action === 'up'     && i > 0)               swap(i, i - 1);
      if (btn.dataset.action === 'down'   && i < files.length - 1) swap(i, i + 1);
      if (btn.dataset.action === 'remove') removeFile(i);
    });

    // Drag-and-drop reorder
    let dragSrc = null;
    item.addEventListener('dragstart', (e) => {
      dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (!dragSrc || dragSrc === item) return;
      const fromIdx = getItemIndex(dragSrc);
      const toIdx   = getItemIndex(item);
      if (fromIdx !== -1 && toIdx !== -1) swap(fromIdx, toIdx);
    });

    item.appendChild(thumbWrap);
    item.appendChild(info);
    item.appendChild(actions);
    fileListEl.appendChild(item);
  }

  function getItemIndex(el) {
    return Array.from(fileListEl.children).indexOf(el);
  }

  function swap(a, b) {
    [files[a], files[b]] = [files[b], files[a]];
    renderList();
  }

  function removeFile(idx) {
    files.splice(idx, 1);
    renderList();
    updateUI();
  }

  function renderList() {
    fileListEl.innerHTML = '';
    files.forEach((_, i) => addFileItem(i));
    updateUI();
  }

  function updateUI() {
    const hasFiles = files.length > 0;
    fileListWrap.style.display = hasFiles ? 'flex' : 'none';
    actionBar.style.display    = hasFiles && files.length >= 2 ? 'flex' : 'none';
    fileCountEl.textContent    = `${files.length} archivo${files.length !== 1 ? 's' : ''} · ${files.reduce((s, f) => s + f.pages, 0)} páginas en total`;
    UI.hide(resultArea);
    resultBytes = null;
  }

  async function doMerge() {
    if (files.length < 2) { UI.toast('Añade al menos 2 PDFs', 'warning'); return; }

    UI.setButtonLoading(mergeBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      const merged = await PDFEngine.create();
      for (let i = 0; i < files.length; i++) {
        UI.setProgress(progressBar, progressLabel,
          Math.round((i / files.length) * 90),
          `Procesando "${files[i].file.name}"…`
        );
        const donor = await PDFEngine.load(PDFEngine.cloneBuffer(files[i].buffer));
        const indices = donor.getPageIndices();
        const copied  = await merged.copyPages(donor, indices);
        copied.forEach(p => merged.addPage(p));
      }
      UI.setProgress(progressBar, progressLabel, 95, 'Guardando…');
      resultBytes = await PDFEngine.save(merged);
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      const totalPages = files.reduce((s, f) => s + f.pages, 0);
      resultMeta.textContent = `${files.length} archivos · ${totalPages} páginas · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('PDFs unidos correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(mergeBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    files = [];
    resultBytes = null;
    fileListEl.innerHTML = '';
    fileListWrap.style.display = 'none';
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
