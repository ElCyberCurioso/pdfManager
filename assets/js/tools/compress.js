/* ============================================================
   COMPRESS TOOL
   ============================================================ */
(() => {
  const dropZone      = document.getElementById('dropZone');
  const fileInput     = document.getElementById('fileInput');
  const optionsPanel  = document.getElementById('optionsPanel');
  const actionBar     = document.getElementById('actionBar');
  const compressBtn   = document.getElementById('compressBtn');
  const progressWrap  = document.getElementById('progressWrap');
  const progressBar   = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const resultArea    = document.getElementById('resultArea');
  const resultMeta    = document.getElementById('resultMeta');
  const downloadBtn   = document.getElementById('downloadBtn');
  const startOverBtn  = document.getElementById('startOverBtn');
  const qualityWrap   = document.getElementById('qualityWrap');

  const JPEG_QUALITY = { low: 0.4, medium: 0.65, high: 0.85 };
  const SCALE        = { low: 0.75, medium: 0.9, high: 1.0 };

  let currentFile   = null;
  let currentBuffer = null;
  let resultBytes   = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);
  compressBtn.addEventListener('click', doCompress);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_comprimido'));
  });

  // Show/hide quality panel based on mode
  document.querySelectorAll('input[name="compressMode"]').forEach(r => {
    r.addEventListener('change', () => {
      qualityWrap.style.display = r.value === 'image' ? 'block' : 'none';
    });
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }

    const pages = await Preview.getPageCount(currentBuffer);
    document.getElementById('originalSize').textContent = UI.formatBytes(file.size);
    document.getElementById('pageCount').textContent    = pages;

    UI.show(optionsPanel);
    actionBar.style.display = 'flex';
    UI.hide(resultArea);
    resultBytes = null;
  }

  async function doCompress() {
    const mode = document.querySelector('input[name="compressMode"]:checked').value;

    UI.setButtonLoading(compressBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      if (mode === 'safe') {
        resultBytes = await compressSafe();
      } else {
        const quality = document.querySelector('input[name="quality"]:checked').value;
        resultBytes   = await compressImage(quality);
      }

      const saved   = currentBuffer.byteLength - resultBytes.byteLength;
      const pct     = Math.round((saved / currentBuffer.byteLength) * 100);
      const sign    = saved >= 0 ? '-' : '+';
      const absPct  = Math.abs(pct);

      resultMeta.textContent = [
        `Original: ${UI.formatBytes(currentBuffer.byteLength)}`,
        `Resultado: ${UI.formatBytes(resultBytes.byteLength)}`,
        saved >= 0 ? `Ahorro: ${sign}${absPct}%` : `(el PDF ya estaba optimizado)`,
      ].join(' · ');

      UI.show(resultArea);
      UI.toast('PDF comprimido correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(compressBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  // Safe mode: re-save with pdf-lib (strips dead objects, re-deflates streams)
  async function compressSafe() {
    UI.setProgress(progressBar, progressLabel, 30, 'Cargando PDF…');
    const doc = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));
    UI.setProgress(progressBar, progressLabel, 70, 'Optimizando…');
    const bytes = await doc.save({ useObjectStreams: true });
    UI.setProgress(progressBar, progressLabel, 100, 'Listo');
    return bytes;
  }

  // Image mode: rasterize each page via PDF.js → canvas → JPEG → embed in new PDF
  async function compressImage(qualityKey) {
    const jpegQ = JPEG_QUALITY[qualityKey];
    const scale = SCALE[qualityKey];

    UI.setProgress(progressBar, progressLabel, 5, 'Cargando PDF…');
    const pdfJs = await pdfjsLib.getDocument({ data: currentBuffer.slice(0) }).promise;
    const total = pdfJs.numPages;
    const out   = await PDFEngine.create();

    for (let i = 1; i <= total; i++) {
      UI.setProgress(progressBar, progressLabel,
        5 + Math.round((i / total) * 88),
        `Rasterizando página ${i} de ${total}…`
      );

      const page      = await pdfJs.getPage(i);
      const viewport  = page.getViewport({ scale });
      const canvas    = document.createElement('canvas');
      canvas.width    = viewport.width;
      canvas.height   = viewport.height;

      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      // Canvas → JPEG bytes
      const dataUrl   = canvas.toDataURL('image/jpeg', jpegQ);
      const b64       = dataUrl.split(',')[1];
      const binary    = atob(b64);
      const jpegBytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) jpegBytes[j] = binary.charCodeAt(j);

      const img     = await out.embedJpg(jpegBytes);
      const newPage = out.addPage([viewport.width, viewport.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    }

    UI.setProgress(progressBar, progressLabel, 96, 'Guardando…');
    const bytes = await PDFEngine.save(out);
    UI.setProgress(progressBar, progressLabel, 100, 'Listo');
    return bytes;
  }

  function reset() {
    currentFile = null; currentBuffer = null; resultBytes = null;
    document.getElementById('originalSize').textContent = '—';
    document.getElementById('pageCount').textContent    = '—';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
