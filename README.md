# Clipfile — Browser Extension

Save the current page to your **Clipfile** list, right from your browser
toolbar. Works in Dia, Chrome, Arc, Brave, Edge, and other Chromium browsers.
Browsing, searching and reading the saved list happens in the Clipfile Mac
app — this extension is save-only.

## Features

- **Save the current tab** from the toolbar or with a keyboard shortcut (Alt+S),
  with a toast confirming the save.
- **Import / export** your list as JSON or CSV, and adjust appearance, from the
  extension's Settings page.
- **Cross-device sync** via a private sync key (no account required).

## Sync key

Your list syncs through a hosted service, identified by a private **sync key**:

- A fresh key is generated automatically the first time you use the extension.
- Open the extension's **Settings** page to view, copy, or paste a key.
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
- `background.js` — service worker: save command, periodic sync, save toast
- `options.html` / `options.js` / `options.css` — Settings page
- `welcome.html` / `welcome.js` / `welcome.css` — first-run page (sync key handoff)
- `icons/` — toolbar and store icons
