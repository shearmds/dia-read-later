// offline.js — offline article-body helpers.
//
// Loaded two ways:
//   - service worker (background.js) via importScripts('offline.js') — uses
//     extraction, crypto, upload, and the local cache.
//   - the reader page (reader.html) via <script src> — uses only the local
//     cache (offlineGetBody) to render an already-captured article offline.
//
// Crypto matches ../readlater-sync/CRYPTO.md and its frozen test vector so the
// iOS app can decrypt what this uploads. Names are prefixed `offline*` to avoid
// clashing with background.js globals in the shared service-worker scope.

const OFFLINE_SYNC_URL = 'https://readlater-sync.shearm.workers.dev';
// Below this many chars of article text we treat the capture as a paywalled
// stub / not-a-real-article and mark it unavailable rather than caching junk.
const OFFLINE_MIN_LENGTH = 1500;
const OFFLINE_DB = 'rtl-offline';
const OFFLINE_STORE = 'bodies';
const OFFLINE_PAYLOAD_VERSION = 1;

// ---- Local body cache (IndexedDB) — plaintext, on-device only ----------

function offlineOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function offlineCacheBody(record) {
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function offlineGetBody(url) {
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_STORE).get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function offlineDeleteBody(url) {
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Crypto: HKDF-SHA256 -> AES-256-GCM (see CRYPTO.md) -----------------

async function offlineDeriveKey(token) {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('rtl-offline-v1'), info: enc.encode('body') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function offlineBytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Returns wire = base64( iv(12) || ciphertext||tag ). Random iv per body.
async function offlineEncrypt(plaintext, token) {
  const key = await offlineDeriveKey(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const wire = new Uint8Array(iv.length + ct.byteLength);
  wire.set(iv, 0);
  wire.set(new Uint8Array(ct), iv.length);
  return offlineBytesToB64(wire);
}

function offlineB64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Inverse of offlineEncrypt: wire = base64( iv(12) || ciphertext||tag ).
async function offlineDecrypt(wireBase64, token) {
  const key = await offlineDeriveKey(token);
  const bytes = offlineB64ToBytes(wireBase64);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

// ---- Extraction: strong capture via Readability on the live DOM ---------

// Injects the vendored libs, then runs the extractor in the tab's isolated
// world. Returns { ok, title, html, length, excerpt, siteName } or { ok:false }.
async function offlineExtract(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['vendor/Readability.js', 'vendor/purify.js'],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        const clone = document.cloneNode(true);
        const article = new Readability(clone).parse();
        if (!article || !article.content) return { ok: false, reason: 'no-article' };
        const html = DOMPurify.sanitize(article.content, { USE_PROFILES: { html: true } });
        return {
          ok: true,
          title: article.title || document.title || '',
          html,
          length: article.length || (article.textContent || '').length,
          excerpt: article.excerpt || '',
          siteName: article.siteName || '',
        };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },
  });
  return (results && results[0] && results[0].result) || { ok: false, reason: 'no-result' };
}

// Builds the plaintext payload that gets encrypted for other devices. Sensitive
// fields (the article itself) live INSIDE this envelope, so the Worker only
// ever sees ciphertext. iOS decrypts and reads this same shape.
function offlineBuildPayload(url, res) {
  return JSON.stringify({
    v: OFFLINE_PAYLOAD_VERSION,
    url,
    title: res.title || '',
    siteName: res.siteName || '',
    excerpt: res.excerpt || '',
    length: res.length || 0,
    html: res.html || '',
    capturedAt: Date.now(),
  });
}

// ---- Worker body store (encrypted bridge to other devices) --------------

async function offlineUpload(url, wire, token) {
  const res = await fetch(`${OFFLINE_SYNC_URL}/body`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ url, ciphertext: wire, meta: { v: OFFLINE_PAYLOAD_VERSION } }),
  });
  return res.ok;
}

async function offlineRemoteDelete(url, token) {
  try {
    await fetch(`${OFFLINE_SYNC_URL}/body?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } catch {
    // best-effort GC; the tombstone can be retried later
  }
}

// Downloads a body that was captured on ANOTHER device (e.g. the iPhone),
// decrypts it, caches it locally, and returns the cache record — or null if
// the server has no copy (404) or we're offline. This is what makes an item
// marked offline:"saved" elsewhere actually readable here.
async function offlineFetchBody(url, token) {
  const res = await fetch(`${OFFLINE_SYNC_URL}/body?url=${encodeURIComponent(url)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null; // 404 = never uploaded (e.g. captured before /body existed)
  const { ciphertext } = await res.json();
  const plain = await offlineDecrypt(ciphertext, token);
  const env = JSON.parse(plain); // { v, url, title, siteName, excerpt, length, html, capturedAt }
  const record = {
    url,
    title: env.title || '',
    html: env.html || '',
    siteName: env.siteName || '',
    excerpt: env.excerpt || '',
    length: env.length || 0,
    savedAt: Date.now(),
  };
  await offlineCacheBody(record);
  return record;
}

// Within a service-worker lifetime, remember URLs we tried and failed to fetch
// so a minutely sync doesn't hammer the Worker with the same 404s.
const offlineFetchAttempted = new Set();

// Pre-downloads bodies for items marked saved that aren't cached here yet, so
// cross-device articles are readable offline without opening them online first.
// Call after a sync, while online. Mirrors the iOS app's prefetchMissing.
async function offlinePrefetchMissing(items, token) {
  for (const item of items) {
    if (item.offline !== 'saved') continue;
    if (offlineFetchAttempted.has(item.url)) continue;
    if (await offlineGetBody(item.url)) continue; // already cached
    try {
      const rec = await offlineFetchBody(item.url, token);
      if (!rec) offlineFetchAttempted.add(item.url); // 404 — stop retrying this session
    } catch {
      offlineFetchAttempted.add(item.url); // offline/error — retry next SW lifetime
    }
  }
}
