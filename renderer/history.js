// Works out "which series / which chapter" from a page URL + title, for any site.
// Most manga/manhwa sites put "chapter-12", "/chapter/12", "ch-12" or "episode-12" in the URL.

const CHAPTER_IN_PATH = /(?:^|[\/\-_])(chapter|chap|ch|episode|ep)[\/\-_]?(\d+(?:[.\-]\d+)?)(?![a-z])/i;
const CHAPTER_IN_TITLE = /\b(chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d+(?:\.\d+)?)/i;
const TITLE_SPLIT = /\s+[|–—-]\s+|\s*\|\s*/;

function prettySlug(slug) {
  return decodeURIComponent(slug || '')
    .replace(/[-_]+[0-9a-f]{6,}$/i, '')   // trailing ids like "-1a2b3c4d"
    .replace(/^\d+[-_]/, '')               // leading ids like "1234-"
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function seriesFromTitle(title) {
  if (!title) return '';
  const parts = title.split(TITLE_SPLIT).map((p) => p.trim()).filter(Boolean);
  // "Solo Leveling Chapter 12 - Site" -> "Solo Leveling"
  for (const p of parts) {
    const m = p.match(CHAPTER_IN_TITLE);
    if (m) {
      const before = p.slice(0, m.index).replace(/[\s,:\-–|]+$/, '').trim();
      if (before) return before;
    }
  }
  // "Chapter 12 | Solo Leveling | Site" -> "Solo Leveling"
  const plain = parts.find((p) => !CHAPTER_IN_TITLE.test(p));
  return plain || '';
}

/**
 * Returns { key, series, chapter, host } if the page looks like a chapter, otherwise null.
 */
function parseReading(url, title) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  const host = u.hostname.replace(/^www\./, '');
  const path = decodeURIComponent(u.pathname);
  let chapter = null;
  let keyPath = null;

  const m = path.match(CHAPTER_IN_PATH);
  if (m) {
    chapter = u.searchParams.get('episode_no') || m[2].replace('-', '.');
    // cut the path at the start of the segment that holds "chapter"
    const idx = m.index;
    keyPath = path[idx] === '/' ? path.slice(0, idx) : path.slice(0, path.lastIndexOf('/', idx));
  } else {
    const q = u.searchParams.get('episode_no') || u.searchParams.get('chapter');
    const t = (title || '').match(CHAPTER_IN_TITLE);
    if (q) chapter = q;
    else if (t) chapter = t[2];
    else return null;
  }

  let series = seriesFromTitle(title);
  if (!series && keyPath) series = prettySlug(keyPath.split('/').filter(Boolean).pop());
  if (!series) series = host;

  // a stable key per series: same site + same series path (or same name)
  const titleNo = u.searchParams.get('title_no');
  const key = host + ':' + (titleNo ? 'title_no=' + titleNo
    : keyPath && keyPath.length > 1 ? keyPath.replace(/\/+$/, '').toLowerCase()
    : series.toLowerCase());

  // the series' own page (usually has the cover as og:image)
  let seriesUrl = keyPath && keyPath.length > 1 ? u.origin + keyPath : null;
  if (titleNo && seriesUrl) seriesUrl += '/list?title_no=' + titleNo;   // Webtoon

  return { key, series, chapter, host, seriesUrl };
}

/** The history key a series page would have (to recognise "you're on the page of a series you read"). */
function seriesKeyFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const titleNo = u.searchParams.get('title_no');
  if (titleNo) return host + ':title_no=' + titleNo;
  return host + ':' + decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase();
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Runs inside the web page: icon links, og:image, and a likely cover image from the DOM.
const PAGE_META_SCRIPT = `(() => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const icons = [...document.querySelectorAll('link[rel]')]
    .filter((l) => /(^|\\s)(icon|apple-touch-icon(-precomposed)?)(\\s|$)/i.test(l.rel))
    .map((l) => ({ href: abs(l.getAttribute('href')), rel: l.rel.toLowerCase(), sizes: l.getAttribute('sizes') || '' }));
  const meta = (n) => document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]')?.content;
  const og = abs(meta('og:image') || meta('twitter:image') || '') || null;
  const portrait = [...document.images].filter((i) => i.naturalWidth >= 120 && i.naturalHeight > i.naturalWidth * 1.15 && i.naturalHeight < i.naturalWidth * 2.2);
  const hit = portrait.find((i) => /cover|thumb|poster/i.test(i.className + ' ' + i.alt + ' ' + i.currentSrc + ' ' + (i.parentElement?.className || '')));
  return { icons, og, domCover: hit ? hit.currentSrc : null };
})()`;

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return new Date(ts).toLocaleDateString();
}

// Injected into the web page to put the reader back where they stopped. Pages
// load images lazily, so keep trying while the page grows; stop as soon as the user scrolls.
function restoreScrollScript(y) {
  return `(() => {
    const target = ${Math.round(y)};
    let tries = 0, stop = false;
    const cancel = () => { stop = true; };
    ['wheel', 'keydown', 'touchstart', 'mousedown'].forEach(e => addEventListener(e, cancel, { once: true, passive: true }));
    const t = setInterval(() => {
      if (stop || ++tries > 60) return clearInterval(t);
      const el = document.scrollingElement || document.documentElement;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 20 && tries > 6) clearInterval(t);
    }, 250);
  })()`;
}
