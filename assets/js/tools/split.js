/* ============================================================
   SPLIT TOOL
   ============================================================ */
(() => {
  const dropZone      = document.getElementById('dropZone');
  const fileInput     = document.getElementById('fileInput');
  const optionsPanel  = document.getElementById('optionsPanel');
  const actionBar     = document.getElementById('actionBar');
  const splitBtn      = document.getElementById('splitBtn');
  const progressWrap  = document.getElementById('progressWrap');
  const progressBar   = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const resultArea    = document.getElementById('resultArea');
  const resultMeta    = document.getElementById('resultMeta');
  const downloadBtn   = document.getElementById('downloadBtn');
  const startOverBtn  = document.getElementById('startOverBtn');
  const extractGrid   = document.getElementById('extractGrid');
  const intervalSlider= document.getElementById('intervalNum');
  const intervalVal   = document.getElementById('intervalVal');
  const intervalHint  = document.getElementById('intervalHint');

  let currentFile   = null;
  let currentBuffer = null;
  let totalPages    = 0;
  let resultZip     = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);
  splitBtn.addEventListener('click', doSplit);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultZip) Download.saveZip(resultZip, Download.buildName(currentFile.name, '', '_dividido').replace('.pdf', '.zip'));
  });

  document.getElementById('selectAllExtract').addEventListener('click', () =>
    document.querySelectorAll('#extractGrid .page-thumb').forEach(t => t.classList.add('selected')));
  document.getElementById('deselectAllExtract').addEventListener('click', () =>
    document.querySelectorAll('#extractGrid .page-thumb').forEach(t => t.classList.remove('selected')));

  // Mode switcher
  document.querySelectorAll('input[name="splitMode"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('modeInterval').style.display = r.value === 'interval' ? 'block' : 'none';
      document.getElementById('modeRanges').style.display   = r.value === 'ranges'   ? 'block' : 'none';
      document.getElementById('modeExtract').style.display  = r.value === 'extract'  ? 'block' : 'none';
    });
  });

  // Interval slider
  intervalSlider.addEventListener('input', () => {
    const v = parseInt(intervalSlider.value);
    intervalVal.textContent = v;
    if (totalPages) {
      const chunks = Math.ceil(totalPages / v);
      intervalHint.textContent = `Generará ${chunks} archivo${chunks !== 1 ? 's' : ''} de ${v} página${v !== 1 ? 's' : ''} cada uno.`;
    }
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }
    totalPages = await Preview.getPageCount(currentBuffer);

    // Update interval slider max
    intervalSlider.max = totalPages;
    intervalSlider.dispatchEvent(new Event('input'));

    // Build extract grid
    await buildExtractGrid();

    UI.show(optionsPanel);
    actionBar.style.display = 'flex';
    UI.hide(resultArea);
    resultZip = null;
  }

  async function buildExtractGrid() {
    extractGrid.innerHTML = '';
    const thumbs = await Preview.renderAllPages(currentBuffer, 110);
    thumbs.forEach(({ canvas, pageNum }) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.dataset.page = pageNum;

      const wrap = document.createElement('div');
      wrap.className = 'page-thumb__canvas-wrap';
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      wrap.appendChild(c);

      const label = document.createElement('span');
      label.className = 'page-thumb__label';
      label.textContent = `Pág. ${pageNum}`;

      thumb.addEventListener('click', () => thumb.classList.toggle('selected'));
      thumb.appendChild(wrap);
      thumb.appendChild(label);
      extractGrid.appendChild(thumb);
    });
  }

  async function doSplit() {
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    let chunks; // array of int[] (zero-based page indices per chunk)

    try {
      chunks = buildChunks(mode);
    } catch (err) {
      UI.toast(err.message, 'warning');
      return;
    }
    if (!chunks.length) { UI.toast('No hay páginas para procesar', 'warning'); return; }

    UI.setButtonLoading(splitBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      const src = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));
      const stem = currentFile.name.replace(/\.pdf$/i, '');
      const files = {};

      for (let i = 0; i < chunks.length; i++) {
        UI.setProgress(progressBar, progressLabel,
          Math.round(((i + 1) / chunks.length) * 90),
          `Generando parte ${i + 1} de ${chunks.length}…`
        );
        const out  = await PDFEngine.create();
        const pages = await out.copyPages(src, chunks[i]);
        pages.forEach(p => out.addPage(p));
        const bytes = await PDFEngine.save(out);
        const name  = `${stem}_parte${i + 1}.pdf`;
        files[name] = new Uint8Array(bytes);
      }

      UI.setProgress(progressBar, progressLabel, 95, 'Comprimiendo ZIP…');
      resultZip = await zipFiles(files);
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      resultMeta.textContent = `${chunks.length} archivo${chunks.length !== 1 ? 's' : ''} generado${chunks.length !== 1 ? 's' : ''} · ${UI.formatBytes(resultZip.byteLength)}`;
      UI.show(resultArea);
      UI.toast('PDF dividido correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(splitBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function buildChunks(mode) {
    if (mode === 'interval') {
      const n = parseInt(intervalSlider.value);
      const chunks = [];
      for (let i = 0; i < totalPages; i += n) {
        const end = Math.min(i + n, totalPages);
        chunks.push(Array.from({ length: end - i }, (_, k) => i + k));
      }
      return chunks;
    }

    if (mode === 'ranges') {
      const raw = document.getElementById('rangesInput').value.trim();
      if (!raw) throw new Error('Introduce al menos un rango');
      return parseRanges(raw, totalPages);
    }

    if (mode === 'extract') {
      const selected = Array.from(document.querySelectorAll('#extractGrid .page-thumb.selected'))
        .map(t => parseInt(t.dataset.page) - 1);
      if (!selected.length) throw new Error('Selecciona al menos una página');
      return [selected];
    }
    return [];
  }

  function parseRanges(raw, total) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    return parts.map(part => {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`Rango no válido: "${part}". Usa formato como 1-3 o 5`);
      const from = parseInt(m[1]);
      const to   = m[2] ? parseInt(m[2]) : from;
      if (from < 1 || to > total || from > to)
        throw new Error(`Rango "${part}" fuera de límites (1-${total})`);
      return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
    });
  }

  function zipFiles(files) {
    return new Promise((resolve, reject) => {
      fflate.zip(files, { level: 0 }, (err, data) => {
        if (err) reject(err); else resolve(data);
      });
    });
  }

  function reset() {
    currentFile = null; currentBuffer = null; totalPages = 0; resultZip = null;
    extractGrid.innerHTML = '';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
