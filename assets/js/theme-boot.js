/* Aplica el tema guardado antes del primer pintado (evita el parpadeo). */
(function () {
  try {
    var t = localStorage.getItem('pdfm-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* almacenamiento no disponible */ }
})();
