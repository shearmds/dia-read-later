# RTL: Research Sync — Safari (macOS)

A Safari-on-Mac wrapper around the **same** web extension that ships to
Chrome/Dia/Arc/Brave/Edge. This lets Safari-on-Mac users use RTL without
switching browsers. It is **additive** — the Chrome extension remains the
primary desktop path.

## Single source of truth
The canonical extension code lives at the **repo root** (`../manifest.json`,
`../popup.js`, `../background.js`, `../offline.js`, `../reader.*`, `../icons/`,
`../vendor/`). This Xcode project only *hosts* it: the files are **copied** into
`RTL Research Sync Extension/Resources/`.

**After editing any extension file at the repo root, re-sync before building:**

```sh
./safari-mac/sync-resources.sh
```

Then rebuild in Xcode (or with `xcodebuild`). Do not hand-edit the copies in
`Resources/` — they are overwritten by the sync script.

## How it was generated
```sh
xcrun safari-web-extension-converter <clean-staging-dir> \
  --project-location <tmp> --app-name "RTL Research Sync" \
  --bundle-identifier com.mdshear.ReadLater.safari-mac \
  --macos-only --swift --copy-resources
```
Generated from a clean staging copy (not the repo root directly) so `.git`,
`test/`, and this folder aren't dragged into the extension bundle.

## Bundle IDs
- App: `com.mdshear.ReadLater.safari-mac`
- Extension: `com.mdshear.ReadLater.safari-mac.Extension` (must stay prefixed by the app ID)

## Building / running
Open `RTL Research Sync.xcodeproj` in Xcode, select the "RTL Research Sync"
scheme, and Run. Then enable it in Safari → Settings → Extensions. For dev,
Safari → Settings → Developer → "Allow unsigned extensions" may be needed until
the app is installed to /Applications.

## Known Safari notes (verify at runtime)
- `favicon` permission is unsupported by Safari; `popup.js` already falls back to
  Google's favicon service via the `<img> onerror` chain, so icons still render.
- Runtime paths to smoke-test on Safari: the 1-min `chrome.alarms` sync loop,
  `chrome.scripting.executeScript` offline capture, and `chrome.storage` persistence.

## Publishing
Same constraint as the rest of RTL: App Store uploads need Xcode 27 GM (fall 2026)
on this Mac. Alternative for earlier real-world use: **Developer ID signing +
notarization** for direct distribution outside the App Store.
