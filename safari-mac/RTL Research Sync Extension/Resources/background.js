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

chrome.runtime.onInstalled.addListener(setupAlarms);
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

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-page') return;

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url || tab.url.startsWith('chrome://')) return;

    const { readLater = [] } = await chrome.storage.local.get('readLater');
    const existing = readLater.find(item => item.url === tab.url);
    if (existing && !existing.deleted) return;

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
    } catch {
        // Offline — continue working locally, retry on next alarm
    }
}
