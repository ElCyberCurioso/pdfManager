/* ============================================================
   UI — Toast, progress bar, spinner helpers
   ============================================================ */

const UI = (() => {
  // ---- Toast ----
  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
      success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      info:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
  }

  // ---- Progress ----
  function setProgress(barEl, labelEl, value, text = '') {
    if (barEl) barEl.style.width = `${Math.min(100, Math.max(0, value))}%`;
    if (labelEl) labelEl.textContent = text || `${Math.round(value)}%`;
  }

  function showProgress(wrapEl) {
    if (wrapEl) wrapEl.style.display = 'block';
  }

  function hideProgress(wrapEl) {
    if (wrapEl) wrapEl.style.display = 'none';
  }

  // ---- Button loading state ----
  function setButtonLoading(btn, loading, originalText = '') {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn._originalHTML = btn.innerHTML;
      btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> Procesando…`;
    } else {
      btn.disabled = false;
      btn.innerHTML = btn._originalHTML || originalText || btn.innerHTML;
    }
  }

  // ---- Show / hide elements ----
  function show(el) {
    if (el) el.classList.add('visible');
  }
  function hide(el) {
    if (el) el.classList.remove('visible');
  }
  function toggle(el, condition) {
    if (condition) show(el); else hide(el);
  }

  // ---- Format bytes ----
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  return { toast, setProgress, showProgress, hideProgress, setButtonLoading, show, hide, toggle, formatBytes };
})();
