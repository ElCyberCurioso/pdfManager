/* ============================================================
   REORDER TOOL
   ============================================================ */
(() => {
  const dropZone     = document.getElementById('dropZone');
  const fileInput    = document.getElementById('fileInput');
  const optionsPanel = document.getElementById('optionsPanel');
  const pageGrid     = document.getElementById('pageGrid');
  const pageInfo     = document.getElementById('pageInfo');
  const actionBar    = document.getElementById('actionBar');
  const saveBtn      = document.getElementById('saveBtn');
  const resetOrderBtn= document.getElementById('resetOrderBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');
  const progressLabel= document.getElementById('progressLabel');
  const resultArea   = document.getElementById('resultArea');
  const resultMeta   = document.getElementById('resultMeta');
  const downloadBtn  = document.getElementById('downloadBtn');
  const startOverBtn = document.getElementById('startOverBtn');

  let currentFile    = null;
  let currentBuffer  = null;
  let originalOrder  = []; // [{canvas, pageNum (1-based)}]
  let currentOrder   = []; // same objects, reordered
  let resultBytes    = null;
  let dragSrcEl      = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);
  saveBtn.addEventListener('click', doSave);
  resetOrderBtn.addEventListener('click', resetOrder);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_reordenado'));
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }

    UI.show(optionsPanel);
    actionBar.style.display = 'flex';
    UI.hide(resultArea);
    resultBytes = null;

    const thumbs = await Preview.renderAllPages(currentBuffer, 130);
    originalOrder = thumbs;
    currentOrder  = [...thumbs];
    renderGrid();
  }

  function renderGrid() {
    pageGrid.innerHTML = '';
    currentOrder.forEach((item, pos) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.draggable = true;
      thumb.dataset.pos = pos;

      const wrap = document.createElement('div');
      wrap.className = 'page-thumb__canvas-wrap';
      wrap.style.position = 'relative';

      // Clone canvas for re-render
      const c = document.createElement('canvas');
      c.width  = item.canvas.width;
      c.height = item.canvas.height;
      c.getContext('2d').drawImage(item.canvas, 0, 0);
      wrap.appendChild(c);

      // Delete button
      const del = document.createElement('button');
      del.style.cssText = `position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;
        background:rgba(0,0,0,0.55);color:#fff;border:none;cursor:pointer;font-size:13px;
        display:flex;align-items:center;justify-content:center;line-height:1;`;
      del.innerHTML = '&times;';
      del.title = 'Eliminar página';
      del.addEventListener('click', (e) => { e.stopPropagation(); removePage(pos); });
      wrap.appendChild(del);

      const label = document.createElement('span');
      label.className = 'page-thumb__label';
      label.textContent = `Pág. ${item.pageNum}`;

      // Drag events
      thumb.addEventListener('dragstart', (e) => {
        dragSrcEl = thumb;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => thumb.classList.add('dragging-page'), 0);
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('dragging-page');
        document.querySelectorAll('.page-thumb').forEach(t => t.classList.remove('drag-over-page'));
      });
      thumb.addEventListener('dragover', (e) => { e.preventDefault(); thumb.classList.add('drag-over-page'); });
      thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-over-page'));
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        thumb.classList.remove('drag-over-page');
        if (!dragSrcEl || dragSrcEl === thumb) return;
        const from = parseInt(dragSrcEl.dataset.pos);
        const to   = parseInt(thumb.dataset.pos);
        const moved = currentOrder.splice(from, 1)[0];
        currentOrder.splice(to, 0, moved);
        renderGrid();
      });

      thumb.appendChild(wrap);
      thumb.appendChild(label);
      pageGrid.appendChild(thumb);
    });

    pageInfo.textContent = `${currentOrder.length} página${currentOrder.length !== 1 ? 's' : ''}`;
  }

  function removePage(pos) {
    if (currentOrder.length <= 1) { UI.toast('El PDF debe tener al menos 1 página', 'warning'); return; }
    currentOrder.splice(pos, 1);
    renderGrid();
  }

  function resetOrder() {
    currentOrder = [...originalOrder];
    renderGrid();
    UI.toast('Orden original restablecido', 'info');
  }

  async function doSave() {
    UI.setButtonLoading(saveBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      UI.setProgress(progressBar, progressLabel, 20, 'Cargando PDF…');
      const src = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));

      UI.setProgress(progressBar, progressLabel, 50, 'Reordenando páginas…');
      // Build zero-based index array in new order
      const newIndices = currentOrder.map(item => item.pageNum - 1);
      const out   = await PDFEngine.create();
      const pages = await out.copyPages(src, newIndices);
      pages.forEach(p => out.addPage(p));

      UI.setProgress(progressBar, progressLabel, 85, 'Guardando…');
      resultBytes = await PDFEngine.save(out);
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      resultMeta.textContent = `${currentOrder.length} páginas · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('PDF reordenado correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(saveBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    currentFile = null; currentBuffer = null; originalOrder = []; currentOrder = []; resultBytes = null;
    pageGrid.innerHTML = '';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
