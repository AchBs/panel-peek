const $ = (id) => document.getElementById(id);
const api = window.bubble;

const web = $('web');
const urlInput = $('url');
const pages = $('pages');
const local = $('local');

let settings = { history: [], sites: [] };
let mode = 'home';
let chapter = null;          // current local chapter
let pinned = false;
let webReady = false;
let isCollapsed = true;
let pendingRestore = null;   // { url, y } to scroll to once the page loads
let editingSites = false;

const MAX_HISTORY = 60;

// ---------- state from main ----------
api.onInit((s) => {
  settings = { ...settings, ...s };
  settings.history = Array.isArray(s.history) ? s.history : [];
  settings.sites = Array.isArray(s.sites) ? s.sites : [];
  $('opacity').value = s.opacity;
  $('zoom').value = s.zoom;
  applyOpacity();
  setMode('home'); // always open on Home with the "Continue" card
});

api.onState(({ collapsed }) => {
  isCollapsed = collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  if (collapsed) savePosition(); // remember exactly where you stopped
  else if (mode === 'home') renderHome();
});

// ---------- tabs ----------
function setMode(m) {
  if (m !== mode) savePosition();
  mode = m;
  for (const [tab, name] of [['tabHome', 'home'], ['tabWeb', 'web'], ['tabLocal', 'local']]) {
    $(tab).classList.toggle('active', m === name);
  }
  $('toolbar').classList.toggle('hidden', m === 'home');
  $('webTools').classList.toggle('hidden', m !== 'web');
  $('localTools').classList.toggle('hidden', m !== 'local');
  $('home').classList.toggle('hidden', m !== 'home');
  web.classList.toggle('hidden', m !== 'web');
  local.classList.toggle('hidden', m !== 'local');
  if (m === 'home') renderHome();
}
$('tabHome').onclick = () => setMode('home');
$('tabWeb').onclick = () => setMode('web');
$('tabLocal').onclick = () => setMode('local');

// ---------- window buttons ----------
$('minBtn').onclick = () => api.collapseNow();
$('closeBtn').onclick = () => { savePosition(); api.quit(); };
$('pinBtn').onclick = () => {
  pinned = !pinned;
  $('pinBtn').classList.toggle('on', pinned);
  api.setPinned(pinned);
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.collapseNow();
});

// ---------- history ----------
function saveHistory() {
  settings.history.sort((a, b) => b.updated - a.updated);
  settings.history.length = Math.min(settings.history.length, MAX_HISTORY);
  api.save({ history: settings.history });
}

function upsert(entry) {
  const i = settings.history.findIndex((h) => h.key === entry.key);
  const old = i >= 0 ? settings.history.splice(i, 1)[0] : {};
  const sameSpot = old.url && entry.url && old.url === entry.url || old.folder && old.folder === entry.folder;
  const merged = { ...old, ...entry, updated: Date.now() };
  if (!sameSpot) { merged.y = 0; merged.page = 0; merged.frac = 0; }
  settings.history.unshift(merged);
  saveHistory();
  return merged;
}

function stripHash(u) { return (u || '').split('#')[0]; }

let recordTimer = null;
function recordWebSoon() {
  clearTimeout(recordTimer);
  recordTimer = setTimeout(recordWeb, 500);
}
function recordWeb() {
  if (!webReady) return;
  const url = stripHash(web.getURL());
  const info = parseReading(url, web.getTitle());
  if (!info) return;
  const existing = settings.history.find((h) => h.key === info.key);
  // only overwrite the series name if we found a better one
  if (existing && existing.series && info.series === info.host) info.series = existing.series;
  upsert({ kind: 'web', url, title: web.getTitle(), ...info });
}

function currentWebEntry() {
  if (!webReady) return null;
  const url = stripHash(web.getURL());
  return settings.history.find((h) => h.kind === 'web' && h.url === url) || null;
}

async function savePosition() {
  try {
    if (mode === 'web') {
      const h = currentWebEntry();
      if (!h) return;
      const y = await web.executeJavaScript('(document.scrollingElement || document.documentElement).scrollTop');
      if (typeof y === 'number' && Math.abs((h.y || 0) - y) > 5) {
        h.y = y; h.updated = Date.now(); saveHistory();
      }
    } else if (mode === 'local' && chapter) {
      const h = settings.history.find((x) => x.kind === 'local' && x.folder === chapter.folder);
      if (!h) return;
      const pos = localPosition();
      h.page = pos.page; h.frac = pos.frac; h.updated = Date.now(); saveHistory();
    }
  } catch { /* page navigating away, ignore */ }
}
// keep the position fresh while reading
setInterval(() => { if (!isCollapsed) savePosition(); }, 2000);

function continueEntry(h) {
  if (h.kind === 'local') {
    api.loadFolder(h.folder).then((c) => {
      if (!c) return alertRow(h, 'Folder not found');
      showChapter(c);
      restoreLocal(h.page || 0, h.frac || 0);
    });
  } else {
    pendingRestore = h.y > 0 ? { url: h.url, y: h.y } : null;
    setMode('web');
    urlInput.value = h.url;
    navigate(h.url);
  }
}

function alertRow(h, msg) {
  h.missing = msg;
  renderHome();
}

// ---------- home screen ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function chapterLabel(h) {
  return h.chapter ? 'Chapter ' + h.chapter : 'Last page read';
}

function renderHome() {
  const card = $('continueCard');
  card.replaceChildren();
  const [latest, ...rest] = settings.history;

  if (!latest) {
    card.append(
      el('div', 'cc-label', 'Nothing read yet'),
      el('div', 'cc-sub', 'Pick a site below and open a chapter. The app remembers where you stopped.')
    );
  } else {
    const info = el('div', 'cc-info');
    info.append(
      el('div', 'cc-label', 'Continue reading'),
      el('div', 'cc-title', latest.series),
      el('div', 'cc-sub', `${chapterLabel(latest)} · ${latest.kind === 'local' ? 'Local folder' : latest.host} · ${timeAgo(latest.updated)}`)
    );
    if (latest.missing) info.append(el('div', 'cc-err', latest.missing));
    const btn = el('button', 'primary', 'Continue ▸');
    btn.onclick = () => continueEntry(latest);
    card.append(info, btn);
  }

  const list = $('recentList');
  list.replaceChildren();
  if (!rest.length) list.append(el('li', 'empty', latest ? 'Your other series will show up here.' : ''));
  for (const h of rest) {
    const li = el('li');
    const main = el('button', 'row');
    main.title = h.url || h.folder;
    main.append(el('span', 'row-title', h.series), el('span', 'row-sub', `${chapterLabel(h)} · ${timeAgo(h.updated)}`));
    main.onclick = () => continueEntry(h);
    const del = el('button', 'icon small', '✕');
    del.title = 'Remove from history';
    del.onclick = () => {
      settings.history = settings.history.filter((x) => x !== h);
      saveHistory(); renderHome();
    };
    li.append(main, del);
    list.append(li);
  }

  const sites = $('sites');
  sites.replaceChildren();
  for (const s of settings.sites) {
    const b = el('button', 'site');
    b.title = s.url;
    b.append(el('span', 'site-icon', s.name.trim().charAt(0).toUpperCase()), el('span', 'site-name', s.name));
    b.onclick = () => {
      if (editingSites) return;
      setMode('web'); urlInput.value = s.url; navigate(s.url);
    };
    if (editingSites) {
      const x = el('span', 'site-del', '✕');
      x.onclick = (e) => {
        e.stopPropagation();
        settings.sites = settings.sites.filter((v) => v !== s);
        api.save({ sites: settings.sites }); renderHome();
      };
      b.append(x);
    }
    sites.append(b);
  }
  $('editSites').textContent = editingSites ? 'done' : 'edit';
  $('addSiteForm').classList.toggle('hidden', !editingSites);
}

$('editSites').onclick = () => { editingSites = !editingSites; renderHome(); };

function addSite(name, url) {
  url = normalizeUrl(url);
  if (!/^https?:/.test(url)) return;
  if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { return; } }
  settings.sites.push({ name, url });
  api.save({ sites: settings.sites });
}
$('addSiteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addSite($('siteName').value.trim(), $('siteUrl').value.trim());
  $('siteName').value = ''; $('siteUrl').value = '';
  renderHome();
});
$('addSiteBtn').onclick = () => {
  if (!webReady) return;
  try {
    const u = new URL(web.getURL());
    if (!/^https?:$/.test(u.protocol)) return;
    if (settings.sites.some((s) => new URL(s.url).hostname === u.hostname)) return flash($('addSiteBtn'), '✓');
    const name = (web.getTitle().split(TITLE_SPLIT).pop() || u.hostname).slice(0, 24);
    addSite(name, u.origin);
    flash($('addSiteBtn'), '★');
  } catch {}
};
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 900);
}

// refresh "x min ago" labels
setInterval(() => { if (mode === 'home' && !isCollapsed) renderHome(); }, 60000);

// ---------- web mode ----------
function navigate(url) {
  // loadURL only works once the webview is attached; before that, setting src is the safe way
  if (webReady) web.loadURL(url).catch(() => {});
  else web.src = url;
}

function normalizeUrl(v) {
  v = (v || '').trim();
  if (!v) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(v) || v.startsWith('about:')) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return 'https://' + v;
  return 'https://www.google.com/search?q=' + encodeURIComponent(v);
}

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(normalizeUrl(urlInput.value));
    urlInput.blur();
  }
});
urlInput.addEventListener('focus', () => urlInput.select());

$('backBtn').onclick = () => webReady && web.canGoBack() && web.goBack();
$('fwdBtn').onclick = () => webReady && web.canGoForward() && web.goForward();
$('reloadBtn').onclick = () => webReady && web.reload();

web.addEventListener('dom-ready', () => {
  webReady = true;
  web.setZoomFactor(Number(settings.zoom) || 1);
});
const onNav = (e) => {
  if (!e.url || e.url === 'about:blank') return;
  if (document.activeElement !== urlInput) urlInput.value = e.url;
  api.save({ lastUrl: e.url });
  recordWebSoon();
};
web.addEventListener('did-navigate', onNav);
web.addEventListener('did-navigate-in-page', (e) => e.isMainFrame && onNav(e));
web.addEventListener('page-title-updated', recordWebSoon);
web.addEventListener('did-stop-loading', () => {
  recordWebSoon();
  if (pendingRestore && stripHash(web.getURL()) === stripHash(pendingRestore.url)) {
    web.executeJavaScript(restoreScrollScript(pendingRestore.y)).catch(() => {});
    pendingRestore = null;
  }
});

// ---------- local folder mode ----------
function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
    .replace(/^\/+/, '').replace(/^([A-Za-z])%3A/, '$1:');
}

function showChapter(c, switchTab = true) {
  chapter = c;
  $('chapName').textContent = c.name;
  $('chapName').title = c.folder;
  $('prevChap').disabled = !c.prev;
  $('nextChap').disabled = !c.next;
  pages.replaceChildren();
  if (!c.images.length) {
    pages.append(el('div', 'empty', 'No images in this folder.'));
  } else {
    for (const p of c.images) {
      const img = document.createElement('img');
      img.decoding = 'async';
      img.src = fileUrl(p);
      pages.appendChild(img);
    }
    if (c.next) {
      const end = el('div', 'end');
      const b = el('button', 'text', 'Next chapter ›');
      b.onclick = () => go(c.next);
      end.append('End of chapter', b);
      pages.appendChild(end);
    }
  }
  local.scrollTop = 0;
  applyZoom();
  if (switchTab) setMode('local');

  // history: series = parent folder, chapter = this folder
  const parts = c.folder.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1] || c.name;
  const parent = parts.slice(0, -1).join('/');
  const num = (name.match(/(\d+(?:\.\d+)?)(?!.*\d)/) || [])[1];
  upsert({
    kind: 'local',
    key: 'local:' + parent.toLowerCase(),
    folder: c.folder,
    series: parts[parts.length - 2] || name,
    chapter: num || name
  });
}

function localPosition() {
  const imgs = pages.querySelectorAll('img');
  const top = local.scrollTop;
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i];
    if (im.offsetTop + im.offsetHeight > top) {
      return { page: i, frac: im.offsetHeight ? (top - im.offsetTop) / im.offsetHeight : 0 };
    }
  }
  return { page: 0, frac: 0 };
}

function restoreLocal(page, frac) {
  if (!page && !frac) return;
  let tries = 0, stop = false;
  const cancel = () => { stop = true; };
  local.addEventListener('wheel', cancel, { once: true, passive: true });
  local.addEventListener('mousedown', cancel, { once: true });
  const t = setInterval(() => {
    const im = pages.querySelectorAll('img')[page];
    if (stop || !im || ++tries > 40) return clearInterval(t);
    local.scrollTop = im.offsetTop + frac * im.offsetHeight;
  }, 250);
}

async function go(folder) {
  savePosition();
  const c = await api.loadFolder(folder);
  if (c) showChapter(c);
}

$('openBtn').onclick = async () => {
  const c = await api.openFolder();
  if (c) showChapter(c);
};
$('prevChap').onclick = () => chapter?.prev && go(chapter.prev);
$('nextChap').onclick = () => chapter?.next && go(chapter.next);

local.tabIndex = 0;
local.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' && chapter?.next) go(chapter.next);
  if (e.key === 'ArrowLeft' && chapter?.prev) go(chapter.prev);
});

// ---------- sliders ----------
function applyOpacity() {
  document.documentElement.style.setProperty('--panel-opacity', settings.opacity);
  document.documentElement.style.setProperty('--bubble-opacity', settings.bubbleOpacity);
}
function applyZoom() {
  const z = Number(settings.zoom) || 1;
  pages.style.width = Math.round(z * 100) + '%';
  if (webReady) web.setZoomFactor(z);
}
$('opacity').oninput = (e) => {
  settings.opacity = Number(e.target.value);
  applyOpacity();
  api.save({ opacity: settings.opacity });
};
$('zoom').oninput = (e) => {
  settings.zoom = Number(e.target.value);
  applyZoom();
  api.save({ zoom: settings.zoom });
};

// ---------- moving & resizing (custom, because the window is transparent/frameless) ----------
function dragHandle(elm, start, move, end) {
  elm.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    elm.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    start();
    const onMove = () => move();
    const onUp = () => {
      elm.removeEventListener('pointermove', onMove);
      elm.removeEventListener('pointerup', onUp);
      elm.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('dragging');
      end();
    };
    elm.addEventListener('pointermove', onMove);
    elm.addEventListener('pointerup', onUp);
    elm.addEventListener('pointercancel', onUp);
  });
}

dragHandle($('titlebar'), api.moveStart, api.moveMove, api.moveEnd);
document.querySelectorAll('.grip').forEach((g) =>
  dragHandle(g, () => api.resizeStart(g.dataset.side), api.resizeMove, api.resizeEnd)
);
