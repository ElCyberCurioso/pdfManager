/* ============================================================
   WATERMARK TOOL
   ============================================================ */
(() => {
  const dropZone      = document.getElementById('dropZone');
  const fileInput     = document.getElementById('fileInput');
  const editorArea    = document.getElementById('editorArea');
  const actionBar     = document.getElementById('actionBar');
  const applyBtn      = document.getElementById('applyBtn');
  const progressWrap  = document.getElementById('progressWrap');
  const progressBar   = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const resultArea    = document.getElementById('resultArea');
  const resultMeta    = document.getElementById('resultMeta');
  const downloadBtn   = document.getElementById('downloadBtn');
  const startOverBtn  = document.getElementById('startOverBtn');
  const previewCanvas = document.getElementById('previewCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');

  const wmText     = document.getElementById('wmText');
  const wmSize     = document.getElementById('wmSize');
  const wmOpacity  = document.getElementById('wmOpacity');
  const wmAngle    = document.getElementById('wmAngle');
  const wmColor    = document.getElementById('wmColor');
  const wmPosition = document.getElementById('wmPosition');

  let currentFile   = null;
  let currentBuffer = null;
  let resultBytes   = null;
  let debounceTimer = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);
  applyBtn.addEventListener('click', doApply);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_marca'));
  });

  // Live preview on any control change
  [wmText, wmSize, wmOpacity, wmAngle, wmColor, wmPosition].forEach(el => {
    el.addEventListener('input', () => {
      // Update displayed values
      document.getElementById('sizeVal').textContent    = wmSize.value;
      document.getElementById('opacityVal').textContent = wmOpacity.value;
      document.getElementById('angleVal').textContent   = wmAngle.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(drawOverlay, 120);
    });
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }

    // Render first page
    await Preview.renderForPreview(currentBuffer, 1, previewCanvas, 500);
    // Size overlay to match
    overlayCanvas.width  = previewCanvas.width;
    overlayCanvas.height = previewCanvas.height;

    editorArea.style.display = 'grid';
    actionBar.style.display  = 'flex';
    UI.hide(resultArea);
    resultBytes = null;
    drawOverlay();
  }

  function drawOverlay() {
    const text    = wmText.value || 'MARCA DE AGUA';
    const size    = parseInt(wmSize.value);
    const opacity = parseInt(wmOpacity.value) / 100;
    const angle   = parseInt(wmAngle.value) * (Math.PI / 180);
    const color   = wmColor.value;
    const mode    = wmPosition.value;

    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle   = color;
    ctx.font        = `bold ${size}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';

    if (mode === 'center') {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.fillText(text, 0, 0);
    } else {
      // Tile
      const stepX = Math.max(ctx.measureText(text).width + size * 2, w / 3);
      const stepY = size * 4;
      for (let y = stepY / 2; y < h + stepY; y += stepY) {
        for (let x = stepX / 2; x < w + stepX; x += stepX) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  async function doApply() {
    const text = wmText.value.trim();
    if (!text) { UI.toast('Introduce el texto de la marca de agua', 'warning'); return; }

    const size     = parseInt(wmSize.value);
    const opacity  = parseInt(wmOpacity.value) / 100;
    const angleDeg = parseInt(wmAngle.value);
    const hex      = wmColor.value;
    const mode     = wmPosition.value;

    // Parse hex color → 0–1 rgb
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    UI.setButtonLoading(applyBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      UI.setProgress(progressBar, progressLabel, 20, 'Cargando PDF…');
      const doc       = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));
      const font      = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages     = doc.getPages();
      const color     = PDFLib.rgb(r, g, b);
      const totalPgs  = pages.length;

      for (let i = 0; i < totalPgs; i++) {
        UI.setProgress(progressBar, progressLabel,
          20 + Math.round((i / totalPgs) * 70),
          `Añadiendo marca a página ${i + 1} de ${totalPgs}…`
        );
        const page = pages[i];
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(text, size);

        if (mode === 'center') {
          page.drawText(text, {
            x:       width  / 2 - textWidth / 2,
            y:       height / 2,
            size,
            font,
            color,
            opacity,
            rotate:  PDFLib.degrees(angleDeg),
          });
        } else {
          // Tile across page
          const stepX = Math.max(textWidth + size * 2, width / 3);
          const stepY = size * 4;
          for (let ty = stepY / 2; ty < height + stepY; ty += stepY) {
            for (let tx = stepX / 2; tx < width + stepX; tx += stepX) {
              page.drawText(text, {
                x: tx - textWidth / 2,
                y: ty,
                size: Math.round(size * 0.7),
                font,
                color,
                opacity,
                rotate: PDFLib.degrees(angleDeg),
              });
            }
          }
        }
      }

      UI.setProgress(progressBar, progressLabel, 95, 'Guardando…');
      resultBytes = await PDFEngine.save(doc);
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      resultMeta.textContent = `Marca "${text}" en ${totalPgs} página${totalPgs !== 1 ? 's' : ''} · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('Marca de agua aplicada', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(applyBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    currentFile = null; currentBuffer = null; resultBytes = null;
    editorArea.style.display = 'none';
    actionBar.style.display  = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
})();
