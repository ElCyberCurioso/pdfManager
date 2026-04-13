/* ============================================================
   PREVIEW — PDF.js thumbnail renderer
   ============================================================ */

const Preview = (() => {
  // Configure PDF.js worker (CDN)
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /**
   * Render a single page of a PDF to a <canvas>.
   *
   * @param {ArrayBuffer} buffer    - PDF bytes
   * @param {number}      pageNum   - 1-based page number
   * @param {HTMLCanvasElement} canvas
   * @param {number}      maxWidth  - Target render width (px)
   */
  async function renderPage(buffer, pageNum, canvas, maxWidth = 150) {
    const pdf  = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    const page = await pdf.getPage(pageNum);

    const naturalViewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / naturalViewport.width;
    const viewport = page.getViewport({ scale });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
    }).promise;
  }

  /**
   * Render all pages of a PDF as thumbnail <canvas> elements.
   *
   * @param {ArrayBuffer} buffer
   * @param {number}      maxWidth
   * @returns {Promise<{canvas: HTMLCanvasElement, pageNum: number}[]>}
   */
  async function renderAllPages(buffer, maxWidth = 150) {
    const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    const total = pdf.numPages;
    const results = [];

    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i);
      const naturalViewport = page.getViewport({ scale: 1 });
      const scale = maxWidth / naturalViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width  = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;

      results.push({ canvas, pageNum: i });
    }

    return results;
  }

  /**
   * Get the page count of a PDF buffer without rendering.
   */
  async function getPageCount(buffer) {
    const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    return pdf.numPages;
  }

  /**
   * Render page to canvas for watermark live preview (higher quality).
   */
  async function renderForPreview(buffer, pageNum, canvas, maxWidth = 520) {
    return renderPage(buffer, pageNum, canvas, maxWidth);
  }

  return { renderPage, renderAllPages, getPageCount, renderForPreview };
})();
