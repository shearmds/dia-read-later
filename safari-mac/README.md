# Clipfile — Safari (macOS)

A Safari-on-Mac wrapper around the **same** web extension that ships to
Chrome/Dia/Arc/Brave/Edge. This lets Safari-on-Mac users use Clipfile without
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
Built with the **Xcode 27 beta**, which is the only toolchain on this machine — the
Xcode 26 Mac was abandoned on 2026-08-28. The project sits at `objectVersion` 77
(downgraded from the beta's 110 back when Xcode 26 had to open it); that is now just
harmless history, and Xcode 27 reads it fine. Leave it at 77 unless something needs
the newer format. App Store uploads wait for the Xcode 27 GM, expected mid-September
2026. (The product is branded **Clipfile**; the on-disk project/target files are
still named `RTL Research Sync` — internal only, not user-visible.)
Alternative to the App Store: **Developer ID signing + notarization** for direct
distribution.
