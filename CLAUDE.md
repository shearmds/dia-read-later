# dia-read-later (Clipfile browser extension)

Chromium MV3 extension — save the current tab to the Clipfile list, browse/search/filter
saved pages, read them offline. Ships in Dia, Chrome, Arc, Brave, Edge. Currently **v2.6**.
Repo: `github.com/shearmds/dia-read-later`. `README.md` covers features and the sync key.

**Naming is genuinely inconsistent here and it isn't a mistake to fix.** The repo is
`dia-read-later`, the Safari wrapper's Xcode project is "RTL Research Sync", and `manifest.json`
says **Clipfile**. User-facing is Clipfile (renamed 2026-08-28, was Research Sync); the on-disk
and repo names are history and are load-bearing — the Chrome Web Store item ID and the Safari
project paths are bound to them.
Renaming the manifest changes what users see, so leave it alone unless that's the intent.

## Part of a four-repo family — check you're in the right one

| Repo | What it is |
|---|---|
| `ReadLater` | the iOS app — **the only App Store app in this workspace** |
| `readlater-sync` | the Cloudflare Worker, **has live users** |
| `read-this-later` | the Raycast extension, live in the Raycast store |
| **this repo** | the browser extension + its Safari wrapper |

Not to be confused with `ReadThisLater` (a static marketing site), `readlater-privacy` (privacy
policy page), or `rtl-safari` (its own repo since 2026-08-28 — a separate Safari
extension, not this repo's `safari-mac/` wrapper).

## Build and test

No build step and no bundler — load unpacked and hit refresh on the extension card.

```sh
node test/offline-crypto.test.mjs     # the crypto interop test
```

`safari-mac/` wraps the same source as a Safari Web Extension (Xcode project "RTL Research
Sync"). It does **not** have its own copy of the extension logic — `safari-mac/sync-resources.sh`
copies the shared files in, so edit the root files and re-sync rather than editing inside
`safari-mac/`.

## Constraints

- **Article bodies are end-to-end encrypted before they leave the browser.** The Worker stores
  ciphertext it cannot read, so any debugging that needs plaintext has to happen client-side.
  The crypto has to stay interoperable with the iOS app, the Raycast extension and the Worker —
  that's what `test/offline-crypto.test.mjs` guards. Run it after touching `offline.js`.
- **The sync key is the whole account.** There is no login and no recovery: anyone holding the
  key can read the list, and losing it loses the list.
- Host permissions include `<all_urls>` because capture reads the page being saved. The sync
  host is pinned to `readlater-sync.shearm.workers.dev`.
