/* ============================================================
   UNLOCK TOOL
   ============================================================ */
(() => {
  const dropZone     = document.getElementById('dropZone');
  const fileInput    = document.getElementById('fileInput');
  const optionsPanel = document.getElementById('optionsPanel');
  const actionBar    = document.getElementById('actionBar');
  const unlockBtn    = document.getElementById('unlockBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');
  const progressLabel= document.getElementById('progressLabel');
  const resultArea   = document.getElementById('resultArea');
  const resultMeta   = document.getElementById('resultMeta');
  const downloadBtn  = document.getElementById('downloadBtn');
  const startOverBtn = document.getElementById('startOverBtn');

  let currentFile   = null;
  let currentBuffer = null;
  let resultBytes   = null;

  FileHandler.init(dropZone, fileInput, onFileAdded);
  unlockBtn.addEventListener('click', doUnlock);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_desbloqueado'));
  });

  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // Allow Enter key to trigger unlock
  document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doUnlock();
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }
    UI.show(optionsPanel);
    actionBar.style.display = 'flex';
    UI.hide(resultArea);
    document.getElementById('password').focus();
  }

  async function doUnlock() {
    const password = document.getElementById('password').value;

    UI.setButtonLoading(unlockBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      UI.setProgress(progressBar, progressLabel, 30, 'Verificando contraseña…');
      const doc = await PDFLib.PDFDocument.load(PDFEngine.cloneBuffer(currentBuffer), {
        password,
        ignoreEncryption: false,
      });

      UI.setProgress(progressBar, progressLabel, 70, 'Eliminando protección…');
      // save() without password options strips the encryption
      resultBytes = await doc.save();
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      resultMeta.textContent = `Protección eliminada · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('PDF desbloqueado correctamente', 'success');
    } catch (err) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
        UI.toast('Contraseña incorrecta', 'error');
      } else {
        UI.toast('Este PDF no está protegido o no se puede desbloquear', 'warning');
      }
    } finally {
      UI.setButtonLoading(unlockBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    currentFile = null; currentBuffer = null; resultBytes = null;
    document.getElementById('password').value = '';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
