/* ============================================================
   PROTECT TOOL
   ============================================================ */
(() => {
  const dropZone     = document.getElementById('dropZone');
  const fileInput    = document.getElementById('fileInput');
  const optionsPanel = document.getElementById('optionsPanel');
  const actionBar    = document.getElementById('actionBar');
  const protectBtn   = document.getElementById('protectBtn');
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
  protectBtn.addEventListener('click', doProtect);
  startOverBtn.addEventListener('click', reset);
  downloadBtn.addEventListener('click', () => {
    if (resultBytes) Download.save(resultBytes, Download.buildName(currentFile.name, '', '_protegido'));
  });

  // Password visibility toggles
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  async function onFileAdded([file]) {
    currentFile   = file;
    currentBuffer = await PDFEngine.fileToBuffer(file).catch(() => null);
    if (!currentBuffer) { UI.toast('Error al leer el PDF', 'error'); return; }
    UI.show(optionsPanel);
    actionBar.style.display = 'flex';
    UI.hide(resultArea);
  }

  async function doProtect() {
    const userPwd  = document.getElementById('userPwd').value.trim();
    const ownerPwd = document.getElementById('ownerPwd').value.trim() || userPwd;

    if (!userPwd) { UI.toast('Introduce al menos la contraseña de apertura', 'warning'); return; }

    const allowPrint  = document.getElementById('permPrint').checked;
    const allowCopy   = document.getElementById('permCopy').checked;
    const allowModify = document.getElementById('permModify').checked;

    UI.setButtonLoading(protectBtn, true);
    progressWrap.style.display = 'block';
    UI.hide(resultArea);

    try {
      UI.setProgress(progressBar, progressLabel, 30, 'Cargando PDF…');
      const doc = await PDFEngine.load(PDFEngine.cloneBuffer(currentBuffer));

      UI.setProgress(progressBar, progressLabel, 60, 'Aplicando protección…');

      const permissions = {};
      if (allowPrint)  permissions.printing       = PDFLib.PrintingAllowedValues.LowResolution;
      if (allowCopy)   permissions.copying        = true;
      if (allowModify) permissions.modifying      = true;
      permissions.annotating    = true;
      permissions.fillingForms  = true;
      permissions.contentAccessibility = true;
      permissions.documentAssembly     = allowModify;

      resultBytes = await doc.save({ userPassword: userPwd, ownerPassword: ownerPwd, permissions });
      UI.setProgress(progressBar, progressLabel, 100, 'Listo');

      resultMeta.textContent = `Contraseña configurada · ${UI.formatBytes(resultBytes.byteLength)}`;
      UI.show(resultArea);
      UI.toast('PDF protegido correctamente', 'success');
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    } finally {
      UI.setButtonLoading(protectBtn, false);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);
    }
  }

  function reset() {
    currentFile = null; currentBuffer = null; resultBytes = null;
    document.getElementById('userPwd').value  = '';
    document.getElementById('ownerPwd').value = '';
    UI.hide(optionsPanel);
    actionBar.style.display = 'none';
    progressWrap.style.display = 'none';
    UI.hide(resultArea);
  }
})();
