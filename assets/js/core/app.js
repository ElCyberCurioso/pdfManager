/* ============================================================
   APP — Carcasa común: cabecera, pie, tema claro/oscuro,
   service worker (uso sin conexión) y gestión global de errores.
   Se ejecuta al importarse.
   ============================================================ */
import { h, $ } from './dom.js';
import { icon, hydrateIcons } from './icons.js';
import { toast } from './ui.js';
import { ROOT, TOOLS, CATEGORIES, toolById, toolUrl } from './registry.js';

export const REPO_URL = 'https://github.com/ElCyberCurioso/pdfManager';

// ---- Tema ------------------------------------------------------
const THEME_KEY = 'pdfm-theme';
function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
function effectiveTheme() {
  const t = document.documentElement.dataset.theme || storedTheme();
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* modo privado */ }
}

function themeButton() {
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon theme-toggle' });
  const paint = () => {
    const dark = effectiveTheme() === 'dark';
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    btn.title = btn.getAttribute('aria-label');
  };
  btn.addEventListener('click', () => { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); paint(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  paint();
  return btn;
}

// ---- Cabecera y pie -------------------------------------------
function renderHeader() {
  const header = $('[data-shell="header"]');
  if (!header) return;
  const current = toolById(document.body.dataset.tool);
  header.classList.add('site-header');
  header.replaceChildren(
    h('div', { class: 'site-header__inner' },
      h('a', { href: ROOT.href, class: 'site-logo', 'aria-label': 'PDF Manager — inicio' },
        h('span', { class: 'site-logo__icon' }, icon('file', { strokeWidth: 2.5 })),
        h('span', { class: 'site-logo__text' }, 'PDF', h('span', {}, 'Manager')),
      ),
      current
        ? h('nav', { class: 'breadcrumb', 'aria-label': 'Ruta de navegación' },
            h('a', { href: ROOT.href }, 'Herramientas'),
            icon('chevronRight'),
            h('span', { 'aria-current': 'page' }, current.title))
        : h('span', { class: 'site-header__spacer' }),
      h('div', { class: 'site-header__actions' },
        h('span', { class: 'privacy-pill', title: 'Los archivos se procesan en tu navegador; nada se sube a ningún servidor.' },
          icon('shield'), h('span', {}, 'Local')),
        themeButton(),
      ),
    ),
  );
}

function renderFooter() {
  const footer = $('[data-shell="footer"]');
  if (!footer) return;
  footer.classList.add('site-footer');
  const groups = CATEGORIES.map((cat) =>
    h('div', { class: 'site-footer__group' },
      h('p', { class: 'site-footer__heading' }, cat.name),
      h('ul', {}, TOOLS.filter((t) => t.category === cat.id).map((t) =>
        h('li', {}, h('a', { href: toolUrl(t) }, t.title)))),
    ));
  footer.replaceChildren(
    h('div', { class: 'site-footer__inner' },
      h('div', { class: 'site-footer__groups' }, groups),
      h('p', { class: 'site-footer__copy' },
        'PDF Manager — procesamiento 100% en tu navegador. Ningún archivo se sube a servidores. ',
        h('a', { href: REPO_URL, rel: 'noopener', target: '_blank' }, 'Código fuente'),
        ' · ',
        h('a', { href: new URL('assets/vendor/versions.json', ROOT).href }, 'Versiones de librerías'),
      ),
    ),
  );
}

function renderToolHeader() {
  const el = $('[data-shell="tool-header"]');
  const tool = toolById(document.body.dataset.tool);
  if (!el || !tool) return;
  el.classList.add('tool-header');
  el.replaceChildren(
    h('div', { class: 'tool-header__icon' }, icon(tool.icon)),
    h('h1', { class: 'tool-header__title' }, tool.title),
    h('p', { class: 'tool-header__desc' }, tool.longDesc || tool.desc),
  );
}

// ---- Service worker (funciona sin conexión) --------------------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT.pathname })
      .catch((err) => console.info('Service worker no registrado:', err.message));
  });
}

// ---- Errores globales -----------------------------------------
function installErrorHandlers() {
  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason;
    if (err?.name === 'PasswordCancelledError') { toast('Operación cancelada.', 'info'); e.preventDefault(); return; }
    console.error(err);
    toast(`Error inesperado: ${err?.message || err}`, 'error');
  });
}

// ---- Init -------------------------------------------------------
renderHeader();
renderToolHeader();
renderFooter();
hydrateIcons();
installErrorHandlers();
registerServiceWorker();
