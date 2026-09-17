importScripts('offline.js');

const SYNC_URL = 'https://readlater-sync.shearm.workers.dev';

// The sync key is a private, per-user token kept in chrome.storage.local.
// A fresh one is generated on first run; paste an existing key (via the popup's
// Sync Key panel) to link this browser to your other devices.
async function getToken() {
    const { syncToken } = await chrome.storage.local.get('syncToken');
    if (syncToken) return syncToken;
    const generated =
        crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '');
    await chrome.storage.local.set({ syncToken: generated });
    return generated;
}

chrome.runtime.onInstalled.addListener((details) => {
    setupAlarms();
    // First install only — explains standalone use + the sync-key pairing
    // step before anyone hits "wait, why isn't this the same list" confusion.
    if (details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    }
});
chrome.runtime.onStartup.addListener(() => {
    setupAlarms();
    syncWithMenuBar();
});

function setupAlarms() {
    chrome.alarms.create('syncWithMenuBar', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'syncWithMenuBar') syncWithMenuBar();
});

// Feedback for a save that happens with no popup open.
//
// **Alt+S used to be completely silent** — no badge, no notification, nothing,
// and three of its paths did nothing at all without saying so: an already-saved
// page returned early, a restricted URL returned early, and a failure to
// capture the body was swallowed. The keystroke's whole appeal is not opening
// the popup, which also means the popup cannot be where the confirmation
// lives.
//
// Two channels, deliberately:
//
//   - **A badge on the toolbar icon.** Always works, on every page including
//     the ones scripts cannot touch, and needs no permission.
//   - **A toast on the page.** Far more visible, and uses `scripting` and
//     `<all_urls>`, which this extension already holds for offline capture. It
//     fails on chrome://, the Web Store and PDFs, which is exactly why the
//     badge exists as well.
//
// **No `notifications` permission.** `chrome.notifications` would be the
// obvious route and would mean adding a permission to a published extension,
// which re-triggers review and shows existing users a scary prompt on update.
// Not worth it for a confirmation toast.
const BADGE_MS = 1800;

async function accentPair() {
    const { accentPair } = await chrome.storage.local.get('accentPair');
    // Parchment, the default accent, for an install whose popup has never been
    // opened and so has never written the pair.
    return accentPair ?? { light: '#6B5741', dark: '#C9B291' };
}

async function flashBadge(text, colour) {
    try {
        await chrome.action.setBadgeText({ text });
        await chrome.action.setBadgeBackgroundColor({ color: colour });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_MS);
    } catch { /* badge is best-effort */ }
}

async function toast(tabId, message, tone) {
    if (tabId == null) return;
    const pair = await accentPair();
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            args: [message, pair.light, pair.dark, tone],
            func: (msg, accentLight, accentDark, kind) => {
                // Shadow DOM so nothing the page ships can restyle or select
                // this, and so removing the host removes every trace.
                const host = document.createElement('div');
                // Top right: near where the toolbar icon that just flashed
                // its badge lives, so the two reads as one confirmation
                // rather than two unrelated things happening at once.
                host.style.cssText =
                    'position:fixed;z-index:2147483647;right:16px;top:16px;' +
                    'pointer-events:none;';
                const root = host.attachShadow({ mode: 'closed' });
                const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const accent = dark ? accentDark : accentLight;
                const ground = dark ? '#181916' : '#F7F3EB';
                const ink = dark ? '#F3EFE5' : '#181916';
                const hairline = dark ? 'rgba(243,239,229,.18)' : 'rgba(41,42,37,.16)';
                const bar = kind === 'warn' ? '#8a6d00'
                          : kind === 'error' ? '#ff3b30' : accent;
                root.innerHTML =
                    '<div style="' +
                    'font:600 13px/1.3 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;' +
                    'color:' + ink + ';background:' + ground + ';' +
                    'border:1px solid ' + hairline + ';border-left:3px solid ' + bar + ';' +
                    'border-radius:10px;padding:10px 14px;' +
                    'box-shadow:0 6px 24px rgba(0,0,0,.18);' +
                    'opacity:0;transform:translateY(-6px);' +
                    'transition:opacity .18s ease,transform .18s ease;' +
                    '">' + msg + '</div>';
                document.documentElement.appendChild(host);
                const card = root.firstElementChild;
                requestAnimationFrame(() => {
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                });
                setTimeout(() => {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(-6px)';
                    setTimeout(() => host.remove(), 220);
                }, 1600);
            },
        });
    } catch {
        // Restricted page. The badge already said it.
    }
}

async function confirmSave(tab, message, tone) {
    const colour = tone === 'warn' ? '#8a6d00'
                 : tone === 'error' ? '#ff3b30'
                 : (await accentPair()).light;
    const glyph = tone === 'ok' ? '\u2713' : tone === 'warn' ? '\u2022' : '\u00d7';
    flashBadge(glyph, colour);
    toast(tab?.id, message, tone);
}

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-page') return;

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // Browser-internal pages cannot be saved and cannot be scripted, so this
    // one can only ever reach the badge.
    if (!tab?.url || /^(chrome|edge|brave|arc|about|devtools|view-source):/.test(tab.url)) {
        confirmSave(tab, 'This page can\u2019t be saved', 'error');
        return;
    }

    const { readLater = [] } = await chrome.storage.local.get('readLater');
    const existing = readLater.find(item => item.url === tab.url);
    if (existing && !existing.deleted) {
        // Used to return silently, which is indistinguishable from the
        // shortcut not being bound at all.
        confirmSave(tab, existing.read ? 'Already saved \u2014 and read' : 'Already in Clipfile', 'warn');
        return;
    }

    const now = Date.now();
    if (existing) {
        existing.deleted = false;
        existing.read = false;
        existing.title = tab.title || tab.url;
        existing.savedAt = now;
        existing.updatedAt = now;
    } else {
        readLater.unshift({ url: tab.url, title: tab.title || tab.url, savedAt: now, read: false, updatedAt: now, deleted: false });
    }
    await chrome.storage.local.set({ readLater });

    confirmSave(tab, 'Saved to Clipfile', 'ok');
    syncWithMenuBar();
    // Auto-capture an offline copy for the page just saved via the shortcut.
    makeOffline(tab.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'syncNow') {
        syncWithMenuBar().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (message.action === 'makeOffline') {
        makeOffline(message.url).then((status) => sendResponse({ status }));
        return true;
    }
    if (message.action === 'deleteBody') {
        // Fire-and-forget GC of both the local cache and the encrypted remote
        // copy when an item is removed. Not awaited by the caller.
        offlineDeleteBody(message.url).catch(() => {});
        getToken().then((token) => offlineRemoteDelete(message.url, token));
        return false;
    }
});

// True when a title is missing or is just the bare hostname (e.g. "nytimes.com") --
// the symptom of a save that happened before the page's real <title> was set.
function titleLooksLikeHostname(title, url) {
    if (!title || !title.trim()) return true;
    let host;
    try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
    if (host.startsWith('www.')) host = host.slice(4);
    return title.trim().toLowerCase() === host;
}

// Repairs a bad title using the headline Readability already found while
// building the offline copy -- no extra fetch, since that extraction already
// runs for every save.
async function repairTitleIfNeeded(url, betterTitle) {
    if (!betterTitle) return;
    const { readLater = [] } = await chrome.storage.local.get('readLater');
    const item = readLater.find((i) => i.url === url);
    if (!item || !titleLooksLikeHostname(item.title, url)) return;
    item.title = betterTitle;
    item.updatedAt = Date.now();
    await chrome.storage.local.set({ readLater });
    syncWithMenuBar();
}

// Sets an item's offline status, bumps updatedAt so the change wins the merge,
// and syncs so every device (and the popup, on its next render) learns it.
async function setOfflineStatus(url, offline) {
    const { readLater = [] } = await chrome.storage.local.get('readLater');
    const now = Date.now();
    const next = readLater.map((i) => (i.url === url ? { ...i, offline, updatedAt: now } : i));
    await chrome.storage.local.set({ readLater: next });
    syncWithMenuBar();
}

// Finds an already-open tab for this URL, or opens one in the background. The
// second boolean says whether we created it (and therefore should close it).
async function offlineTabForUrl(url) {
    const tabs = await chrome.tabs.query({});
    const open = tabs.find((t) => t.url === url);
    if (open) return { tab: open, created: false };

    const tab = await chrome.tabs.create({ url, active: false });
    const loaded = await waitForTabComplete(tab.id, 20000);
    if (!loaded) {
        try { await chrome.tabs.remove(tab.id); } catch {}
        return { tab: null, created: false };
    }
    return { tab, created: true };
}

function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
        }, timeoutMs);
        function listener(id, info) {
            if (id === tabId && info.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(true);
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Strong-capture an article for offline reading: extract on the live DOM,
// cache locally (Mac offline), and upload an E2E-encrypted copy (other devices).
// Returns the final offline status string.
async function makeOffline(url) {
    if (!/^https?:\/\//i.test(url)) {
        await setOfflineStatus(url, 'unavailable');
        return 'unavailable';
    }

    await setOfflineStatus(url, 'requested');

    const { tab, created } = await offlineTabForUrl(url);
    if (!tab) {
        await setOfflineStatus(url, 'unavailable');
        return 'unavailable';
    }

    try {
        const res = await offlineExtract(tab.id);
        if (created) { try { await chrome.tabs.remove(tab.id); } catch {} }

        if (res.ok) await repairTitleIfNeeded(url, res.title);

        if (!res.ok || (res.length || 0) < OFFLINE_MIN_LENGTH) {
            await setOfflineStatus(url, 'unavailable');
            return 'unavailable';
        }

        await offlineCacheBody({
            url,
            title: res.title,
            html: res.html,
            siteName: res.siteName,
            excerpt: res.excerpt,
            length: res.length,
            savedAt: Date.now(),
        });

        const token = await getToken();
        const wire = await offlineEncrypt(offlineBuildPayload(url, res), token);
        await offlineUpload(url, wire, token);

        await setOfflineStatus(url, 'saved');
        return 'saved';
    } catch (e) {
        if (created) { try { await chrome.tabs.remove(tab.id); } catch {} }
        await setOfflineStatus(url, 'unavailable');
        return 'unavailable';
    }
}

async function syncWithMenuBar() {
    try {
        const { readLater = [] } = await chrome.storage.local.get('readLater');
        const token = await getToken();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${SYNC_URL}/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ items: readLater }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) return;
        const { items } = await response.json();
        await chrome.storage.local.set({ readLater: items, lastSync: Date.now() });
        // Pull down bodies captured on other devices so they're readable
        // offline here too (best-effort; skips already-cached items).
        offlinePrefetchMissing(items, token).catch(() => {});

        // Classification runs server-side, async, after /sync already
        // responded — it typically lands within a few seconds, but without
        // this the client wouldn't find out until the next 1-minute alarm.
        // A short burst of cheap /items reads (no classify call, so this
        // can't reintroduce the sync-latency problem we already fixed)
        // closes that gap while someone's actually got the popup open.
        const hasFreshUnsorted = items.some(
            (i) => !i.deleted && !i.folder && Date.now() - i.savedAt < 60_000
        );
        if (hasFreshUnsorted) fastPollForClassify(token);
    } catch {
        // Offline — continue working locally, retry on next alarm
    }
}

let fastPolling = false;

// Cheap follow-up: GET /items (pure KV read, no classify call) every couple
// seconds for a short window, so a classify result that lands in the
// background gets picked up while the popup's likely still open, instead of
// waiting for the next alarm. Stops early once something changes or nothing
// is pending anymore.
async function fastPollForClassify(token, attempts = 5, intervalMs = 2500) {
    if (fastPolling) return;
    fastPolling = true;
    try {
        for (let i = 0; i < attempts; i++) {
            await new Promise((r) => setTimeout(r, intervalMs));
            let res;
            try {
                res = await fetch(`${SYNC_URL}/items`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
            } catch {
                return; // offline — let the normal alarm cadence catch up later
            }
            if (!res.ok) continue;
            const { items } = await res.json();

            const { readLater: current = [] } = await chrome.storage.local.get('readLater');
            const oldFolders = new Map(current.map((i) => [i.url, i.folder]));
            const gained = items.some(
                (i) => i.folder && oldFolders.has(i.url) && !oldFolders.get(i.url)
            );
            if (gained) {
                await chrome.storage.local.set({ readLater: items });
                return;
            }

            const stillPending = items.some(
                (i) => !i.deleted && !i.folder && Date.now() - i.savedAt < 60_000
            );
            if (!stillPending) return;
        }
    } finally {
        fastPolling = false;
    }
}
