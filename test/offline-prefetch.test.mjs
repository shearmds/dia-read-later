// Verifies offlinePrefetchMissing stops re-requesting bodies the Worker doesn't
// have, across service-worker restarts. Run: node test/offline-prefetch.test.mjs
//
// Each "minute" below loads offline.js afresh, as the 1-minute alarm does when
// it wakes a new MV3 service worker; only chrome.storage.local survives. The
// old in-memory Set passed a single-load test and failed this one: 27 missing
// bodies became ~39,000 404s a day.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'offline.js'), 'utf8');

const storage = {}; // survives "restarts", like chrome.storage.local
const chrome = {
  storage: {
    local: {
      get: async (k) => (k in storage ? { [k]: structuredClone(storage[k]) } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) storage[k] = structuredClone(v); },
    },
  },
};

const cached = new Set(); // the local IndexedDB body cache
let requests = [];
let serverHas = new Set();
let networkDown = false;

function freshWorker() {
  const stubs = `
    offlineGetBody = async (url) => (cached.has(url) ? { url } : null);
    offlineFetchBody = async (url) => {
      requests.push(url);
      if (networkDown) throw new Error('offline');
      if (!serverHas.has(url)) return null;
      cached.add(url);
      return { url };
    };
    return { offlinePrefetchMissing };`;
  return new Function('chrome', 'cached', 'ctx', `
    with (ctx) { ${src}\n${stubs} }`)(chrome, cached, {
    get requests() { return requests; },
    get serverHas() { return serverHas; },
    get networkDown() { return networkDown; },
  });
}

const MIN = 60_000, HOUR = 60 * MIN;
const items = [
  ...Array.from({ length: 27 }, (_, i) => ({ url: `https://x.test/missing/${i}`, offline: 'saved' })),
  { url: 'https://x.test/present', offline: 'saved' },
  { url: 'https://x.test/not-offline' },
  { url: 'https://x.test/tombstone', offline: 'saved', deleted: true },
];
serverHas = new Set(['https://x.test/present']);
const t0 = Date.UTC(2026, 10, 21);

// Minute 0: everything marked saved and live is tried once.
await freshWorker().offlinePrefetchMissing(items, 'tok', t0);
assert.equal(requests.length, 28, 'first sync tries every saved, uncached, live item');
assert.ok(!requests.includes('https://x.test/not-offline'));
assert.ok(!requests.includes('https://x.test/tombstone'));
assert.equal(Object.keys(storage.offlineMissing).length, 27, 'only the 404s are remembered');

// The next 23 hours of minutely syncs, each in a fresh worker: zero requests.
requests = [];
for (let m = 1; m < 23 * 60; m += 1) {
  await freshWorker().offlinePrefetchMissing(items, 'tok', t0 + m * MIN);
}
assert.equal(requests.length, 0, 'restarts no longer forget the 404s');

// After a day each missing body is retried once; one has since been uploaded.
serverHas.add('https://x.test/missing/0');
await freshWorker().offlinePrefetchMissing(items, 'tok', t0 + 24 * HOUR + MIN);
assert.equal(requests.length, 27, 'daily retry');
assert.ok(cached.has('https://x.test/missing/0'), 'a late upload is picked up');
assert.equal(Object.keys(storage.offlineMissing).length, 26, 'fetched entry drops out');

// Items removed from the list drop out of the record.
await freshWorker().offlinePrefetchMissing(items.slice(5), 'tok', t0 + 24 * HOUR + 2 * MIN);
assert.equal(Object.keys(storage.offlineMissing).length, 22, 'removed items are pruned');

// A network error retries after 15 minutes, not every minute and not a day later.
for (const k of Object.keys(storage)) delete storage[k];
cached.clear(); requests = []; networkDown = true;
const one = [{ url: 'https://x.test/flaky', offline: 'saved' }];
await freshWorker().offlinePrefetchMissing(one, 'tok', t0);
await freshWorker().offlinePrefetchMissing(one, 'tok', t0 + 10 * MIN);
assert.equal(requests.length, 1, 'no retry within 15 minutes of an error');
networkDown = false; serverHas.add('https://x.test/flaky');
await freshWorker().offlinePrefetchMissing(one, 'tok', t0 + 16 * MIN);
assert.equal(requests.length, 2, 'retried after 15 minutes');
assert.deepEqual(storage.offlineMissing, {}, 'success clears the record');

console.log('offline-prefetch: all assertions passed');
