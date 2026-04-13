/* ============================================================
   ROTATE TOOL
   ============================================================ */
(() => {
  const dropZone     = document.getElementById('dropZone');
  const fileInput    = document.getElementById('fileInput');
  const optionsPanel = document.getElementById('optionsPanel');
  const pageGrid     = document.getElementById('pageGrid');
  const actionBar    = document.getElementById('actionBar');
  const applyBtn     = document.getElementById('applyBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');
  const progressLabel= document.getElementById('progressLabel');
  const resultArea   = document.getElementById('resultArea');
  const resultMeta   = document.getElementById('resultMeta');
  const downloadBtn  = document.getElementById('downloadBtn');
  const startOverBtn = document.getElementById('startOverBtn');

  let currentFile   = null;
  let currentBuffer = null;
  let pageRotations = []; // delta rotations per page (0, 90, 180, 270)
  let totalPages    = 0;
  let resultBytes   = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.page-thumb').forEach(t => t.classList.add('selected'));
  });
  document.getElementById('deselectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.page-thumb').forEach(t => t.classList.remove('selected'));
  });
  document.getElementById('rotLeft').addEventListener('click',  () => applyDelta(-90));
  document.getElementById('rotRight').addEventListener('click', () => applyDelta(90));
  document.getElementById('rot180').addEventListener('click',   () => applyDelta(180));
  document.getElementById('resetRot').addEventListener('click', resetRotations);
  applyBtn.addEventListener('click', doRotate);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_rotado'));
  });

  async function onFileAdded([file]) {
    currentFile = file;
    try {
      currentBuffer = await PDFEngine.fileToBuffer(file);
      totalPages    = await Preview.getPageCount(currentBuffer);
      pageRotations = new Array(totalPages).fill(0);
      await buildGrid();
      UI.show(optionsPanel);
      actionBar.style.display = 'flex';
      UI.hide(resultArea);
    } catch {
      UI.toast('Error al leer el PDF', 'error');
    }
  }

  async function buildGrid() {
    pageGrid.innerHTML = '';
    const thumbs = await Preview.renderAllPages(currentBuffer, 120);
    thumbs.forEach(({ canvas, pageNum }) => {
      const idx = pageNum - 1;
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.dataset.idx = idx;

      const wrap = document.createElement('div');
      wrap.className = 'page-thumb__canvas-wrap';
      wrap.style.position = 'relative';
      canvas.style.transition = 'transform 0.3s ease';
      wrap.appendChild(canvas);

      const badge = document.createElement('span');
      badge.className = 'rotation-badge';
      badge.textContent = '0°';
      wrap.appendChild(badge);

      const label = document.createElement('span');
      label.className = 'page-thumb__label';
      label.textContent = `Pág. ${pageNum}`;

      thumb.appendChild(wrap);
      thumb.appendChild(label);

      thumb.addEventListener('click', () => thumb.classList.toggle('selected'));
      pageGrid.appendChild(thumb);
    });
  }

  function applyDelta(delta) {
    const selected = document.querySelectorAll('.page-thumb.selected');
    if (!selected.length) { UI.toast('Selecciona al menos una página', 'warning'); return; }

    selected.forEach(thumb => {
      const idx = parseInt(thumb.dataset.idx);
      pageRotations[idx] = ((pageRotations[idx] + delta) % 360 + 360) % 360;
      updateThumbVisual(thumb, idx);
    });
  }

  function updateThumbVisual(thumb, idx) {
    const angle = pageRotations[idx];
    const canvas = thumb.querySelector('canvas');
    const badge  = thumb.querySelector('.rotation-badge');
    if (canvas) canvas.style.transform = `rotate(${angle}deg)`;
    if (badge) {
      badge.textContent = `${angle}°`;
      badge.style.display = angle !== 0 ? 'block' : 'none';
    }
    if (angle !== 0) thumb.classList.add('rotated');
    else thumb.classList.remove('rotated');
  }

  function resetRotations() {
    pageRotations.fill(0);
    document.querySelectorAll('.page-thumb').forEach((thumb, idx) => {
      updateThumbVisual(thumb, idx);
    });
  }

  async function doRotate() {
    const hasChanges = pageRotations.some(r => r !== 0);
    if (!hasChanges) { UI.toast('No hay rotaciones que aplicar', 'warning'); return; }

    UI.setButtonLoading(applyBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      UI.setProgress(progressBar, progressLabel, 20, 'Cargando PDF…');
      const doc   = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));
      const pages = doc.getPages();

      UI.setProgress(progressBar, progressLabel, 50, 'Aplicando rotaciones…');
      pages.forEach((page, idx) => {
        if (pageRotations[idx] !== 0) {
          const current = page.getRotation().angle;
          page.setRotation(PDFLib.degrees((current + pageRotations[idx]) % 360));
        }
      });

      UI.setProgress(progressBar, progressLabel, 85, 'Guardando…');
      resultBytes = await PDFEngine.save(doc);
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      const rotated = pageRotations.filter(r => r !== 0).length;
      resultMeta.textContent = `${rotated} página${rotated !== 1 ? 's' : ''} rotada${rotated !== 1 ? 's' : ''} · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('Rotación aplicada correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(applyBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    currentFile = null; currentBuffer = null; pageRotations = []; totalPages = 0; resultBytes = null;
    pageGrid.innerHTML = '';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
