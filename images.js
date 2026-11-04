// Downloads and caches site icons and series covers on disk, so Home loads instantly
// and works offline. Everything goes through the reader's own browser session
// (same cookies / Cloudflare clearance as the pages you read), never a third-party service.
const { session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let cacheDir = null;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT = 30000;        // waiting for a response to start
const IMAGE_TIMEOUT = 90000;  // big covers on slow connections
const inflight = new Map();

function init(dir) {
  cacheDir = dir;
  fs.mkdirSync(cacheDir, { recursive: true });
}

function ses() { return session.fromPartition('persist:manga'); }

function withTimeout(promise, ms = TIMEOUT) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function get(url, referer) {
  const opts = { headers: referer ? { Referer: referer } : {} };
  try {
    return await withTimeout(ses().fetch(url, opts));
  } catch (err) {
    if (!referer || err.message === 'timeout') throw err;
    return withTimeout(ses().fetch(url));   // some setups refuse a custom Referer: retry plain
  }
}

// Work out the real image type from the first bytes (CDNs often send octet-stream).
function sniff(buf, contentType) {
  const hex = buf.subarray(0, 4).toString('hex');
  if (hex.startsWith('ffd8')) return '.jpg';
  if (hex === '89504e47') return '.png';
  if (buf.subarray(0, 4).toString() === 'GIF8') return '.gif';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return '.webp';
  if (hex === '00000100') return '.ico';
  if (buf.subarray(4, 12).toString().startsWith('ftypavif')) return '.avif';
  const head = buf.subarray(0, 300).toString('utf8').trimStart();
  if (/svg/.test(contentType || '') && /^(<\?xml|<svg)/i.test(head)) return '.svg';
  return null;
}

/** Download an image into the cache. Returns its file path, or null. */
async function cacheImage(url, referer) {
  if (!cacheDir || !/^https?:\/\//i.test(url || '')) return null;
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
  for (const ext of ['.jpg', '.png', '.webp', '.gif', '.ico', '.svg', '.avif']) {
    const p = path.join(cacheDir, id + ext);
    if (fs.existsSync(p)) return p;
  }
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    try {
      const res = await get(url, referer);
      if (!res.ok) return null;
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return null;
      const buf = Buffer.from(await withTimeout(res.arrayBuffer(), IMAGE_TIMEOUT));
      if (!buf.length || buf.length > MAX_BYTES) return null;
      const ext = sniff(buf, res.headers.get('content-type'));
      if (!ext) return null;
      const p = path.join(cacheDir, id + ext);
      fs.writeFileSync(p, buf);
      return p;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
  return job;
}

// Returns { html, url } where url is the final address after redirects (sites move domains a lot).
async function fetchHtml(url) {
  try {
    const res = await get(url);
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
    const text = await withTimeout(res.text(), IMAGE_TIMEOUT);
    return { html: text.slice(0, 600000), url: res.url || url };
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"');
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function abs(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

/** Pull icon links and the og:image out of a page's HTML. */
function parseHead(html, base) {
  const icons = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !/(^|\s)(icon|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel)) continue;
    icons.push({ href: abs(href, base), rel, sizes: attr(tag, 'sizes') || '' });
  }
  let og = null;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:url' || key === 'twitter:image') {
      og = abs(attr(tag, 'content') || '', base);
      if (og) break;
    }
  }
  return { icons, og };
}

// Prefer big, square, crisp icons: apple-touch-icon > large PNG/SVG > favicon.ico
function rankIcons(icons) {
  const score = (i) => {
    if (!i.href) return -1;
    const size = Math.max(0, ...String(i.sizes).split(/\s+/).map((s) => parseInt(s, 10) || 0));
    let s = size || 32;
    if (i.rel.includes('apple-touch-icon')) s = Math.max(s, 180);
    if (/\.svg(\?|$)/i.test(i.href) || i.sizes === 'any') s = Math.max(s, 150);
    if (s > 512) s = 100;   // giant splash images are usually not icons
    return s;
  };
  return icons.filter((i) => i.href).sort((a, b) => score(b) - score(a)).map((i) => i.href);
}

/** Best icon for a site. `icons` can come from the live page; otherwise the homepage is fetched. */
async function siteIcon({ pageUrl, icons }) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  let list = Array.isArray(icons) && icons.length ? icons : null;
  if (!list) {
    const page = await fetchHtml(origin + '/');
    list = page ? parseHead(page.html, page.url).icons : [];
    if (page) origin = new URL(page.url).origin;   // follow the site to its new domain
  }
  for (const href of [...rankIcons(list).slice(0, 4), origin + '/favicon.ico']) {
    const p = await cacheImage(href, pageUrl);
    if (p) return p;
  }
  return null;
}

/** Cover for a series: the og:image of its page (or of the chapter page as a fallback). */
async function pageCover(pageUrl) {
  const page = await fetchHtml(pageUrl);
  if (!page) return null;
  const { og } = parseHead(page.html, page.url);
  return og ? cacheImage(og, page.url) : null;
}

/** Delete cached files nothing points to any more (older than a day, so nothing in use is touched). */
function cleanup(keep) {
  if (!cacheDir) return;
  const keepSet = new Set([...keep].filter(Boolean).map((p) => path.resolve(p)));
  const dayAgo = Date.now() - 86400000;
  for (const f of fs.readdirSync(cacheDir)) {
    const p = path.join(cacheDir, f);
    try {
      if (!keepSet.has(path.resolve(p)) && fs.statSync(p).mtimeMs < dayAgo) fs.unlinkSync(p);
    } catch {}
  }
}

module.exports = { init, cacheImage, siteIcon, pageCover, cleanup };
