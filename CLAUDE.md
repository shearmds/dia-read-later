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

## Design — the family system

This extension shares a visual language with Clipfile's iOS app and its four sibling
Mac/iOS apps: **Notch**, **Deets** (`~/Developer/addressbook`), **Prexy**
(`~/Developer/StoryDeskMDS`) and **Jottle** (`~/Developer/QuickNote`). It joined on
2026-09-17.

**The spec lives in Deets, not here:** `~/Developer/addressbook/docs/PLAN-ground-and-glass.md`
for the ground and the accent wash, `PLAN-type-scale.md` for the type. Read them before
changing anything visual.

- **The token block at the top of `popup.css`, `reader.css` and `welcome.css` is
  byte-identical in all three, and is a hand port of `Surfaces.swift` in the iOS app.**
  Keep them identical. The values are copied, not derived — do not "tidy" them.
- **The ground is a 2x2** of (paper | bright) x (light | dark). Light/dark is
  `prefers-color-scheme`; the ground is `data-ground` on `:root`, set by JS, because CSS
  has no media query for "which cream". **Block order in the token block is load-bearing** —
  the plain dark query must precede the bright dark one, and the bright rules rely on
  specificity to beat the plain dark ones.
- **`--wash-light` / `--wash-dark` are precomputed.** They are the chosen accent brightened
  for use as a background fill, which the Swift derives at runtime with HSB maths
  (saturation x1.25, brightness lifted to 0.92 in light only) that CSS cannot do. They are
  regenerated from the accent table, never hand-edited.
- **No gradients, anywhere.** Nothing in this family draws one. The header card border, the
  4px row spine, the save button and the accent swatches were all gradients and all stopped
  being gradients. Jottle records `design: .rounded` as the single largest reason it did not
  look like its siblings; gradients are this surface's equivalent.
- **Watch the specificity of `#settings-panel button`.** It is `0,1,0,1` and outranks any
  bare class, which silently overrode `.theme-swatch` and `.ground-option` backgrounds. Both
  are scoped as `#theme-bar .theme-swatch` / `#ground-bar .ground-option` for that reason.
  This was invisible while `buildThemeBar()` set the swatch colour as an inline style.
- **Stored preferences.** `appTheme` keeps its seven original ids and gains `aurora`; the
  default moved from `ocean` to **`parchment`**, matching the iOS app and the icon. `ground`
  is new, `'paper'` (default) or `'bright'`. Never rename an id — it silently resets the
  user's choice.
- **`--ok` and `--bad` follow neither picker.** A colour is either the theme or it is
  information.
- The **reader's** larger, looser type and its measure are a deliberate exception to the
  row type scale — it is a reading register.

## The save shortcut

`manifest.json` declares one command, `save-page`, suggesting **Alt+S** (⌥S on a Mac). It
saves the current tab and captures the body without opening the popup — `background.js`
handles it and calls `makeOffline` on the same path the popup's Save button does.

**It is already user-selectable, and it can only ever be selectable the browser's way.**
`chrome.commands` has `getAll()` and no setter, deliberately and permanently: an extension
that could silently claim a key combination would be a keylogger with extra steps. Rebinding
happens at `chrome://extensions/shortcuts`, and the Shortcut section in the settings panel
opens it. **Do not go looking for an API to build an in-popup recorder — there isn't one.**

The panel reads the **live** binding through `chrome.commands.getAll()` rather than printing
the manifest's suggestion, because Chrome drops a suggested default silently when another
extension already holds the combination. Printing `Alt+S` unconditionally would advertise a
shortcut that does nothing.

Note `Alt+S` types `ß` on a Mac when nothing claims it; Chrome intercepts it first, so the
default is fine, but that is the kind of thing to check before suggesting a different one.

**It confirms itself, through two channels.** A badge on the toolbar icon always works,
including on pages scripts cannot touch, and needs no permission. An in-page toast in a
**closed shadow root** at the bottom right is the visible one, using `scripting` and
`<all_urls>` which are already held for offline capture; it fails on `chrome://`, the Web
Store and PDFs, which is precisely why the badge is there too. Three tones, distinguished by
a coloured left bar: the accent for a save, amber for already-saved, red for a page that
cannot be saved.

**Do not reach for `chrome.notifications`.** It is the obvious route and it means adding a
permission to a published extension, which re-triggers review and shows every existing user a
prompt on update. Not worth it for a confirmation.

The toast is tinted from `accentPair` in `chrome.storage.local`, which `applyTheme` writes
whenever the accent changes. That exists so `background.js` does not carry a fourth copy of
the palette — it already lives in `popup.js`, `reader.js` and `welcome.js`, and a fifth is how
the Parchment drift started. A fresh install whose popup has never been opened falls back to
Parchment's pair, the app default.

## Constraints

- **Article bodies are end-to-end encrypted before they leave the browser.** The Worker stores
  ciphertext it cannot read, so any debugging that needs plaintext has to happen client-side.
  The crypto has to stay interoperable with the iOS app, the Raycast extension and the Worker —
  that's what `test/offline-crypto.test.mjs` guards. Run it after touching `offline.js`.
- **The sync key is the whole account.** There is no login and no recovery: anyone holding the
  key can read the list, and losing it loses the list.
- Host permissions include `<all_urls>` because capture reads the page being saved. The sync
  host is pinned to `readlater-sync.shearm.workers.dev`.
