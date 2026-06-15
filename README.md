# Read This Later — Browser Extension

Save the current page to your **Read This Later** list, right from your browser
toolbar, and browse your unread saved pages. Works in Dia, Chrome, Arc, Brave,
Edge, and other Chromium browsers.

## Features

- **Save the current tab** from the toolbar or with a keyboard shortcut (Alt+S).
- **Browse, search, and filter** your saved pages (all / unread / read).
- **Mark read/unread** and remove items.
- **Import / export** your list as JSON.
- **Cross-device sync** via a private sync key (no account required).

## Sync key

Your list syncs through a hosted service, identified by a private **sync key**:

- A fresh key is generated automatically the first time you use the extension.
- Open the **🔑 Sync Key** panel to view, copy, or paste a key.
- To share one list across devices (e.g. the iOS app or the Raycast extension),
  paste the **same key** into each.
- Keep your key private — anyone with it can read your saved pages. There is no
  account recovery, so copy it somewhere safe if your list matters to you.

## Install (unpacked, for development)

1. Open `chrome://extensions` (or `dia://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Files

- `manifest.json` — extension manifest (MV3)
- `background.js` — service worker: save command, periodic sync
- `popup.html` / `popup.js` / `popup.css` — toolbar popup UI
- `icons/` — toolbar and store icons
