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
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'syncNow') {
        syncWithMenuBar().then(() => sendResponse({ ok: true }));
        return true;
    }
});

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
    } catch {
        // Offline — continue working locally, retry on next alarm
    }
}
