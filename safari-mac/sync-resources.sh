#!/usr/bin/env bash
# Sync the canonical web-extension source (repo root) into the Safari macOS
# extension's Resources folder. The repo root is the single source of truth;
# this copies it in so Xcode can bundle it. Re-run after editing any extension
# file (manifest.json, popup.*, background.js, offline.js, reader.*, icons/, vendor/).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
RES="$HERE/RTL Research Sync Extension/Resources"

# Canonical extension files (must match the Chrome/Dia extension exactly).
FILES=(
  manifest.json
  background.js
  popup.html popup.js popup.css
  offline.js
  reader.html reader.css reader.js
)
DIRS=(icons vendor)

mkdir -p "$RES"

echo "Syncing extension resources → $RES"
for f in "${FILES[@]}"; do
  cp "$ROOT/$f" "$RES/$f"
  echo "  + $f"
done
for d in "${DIRS[@]}"; do
  rm -rf "$RES/$d"
  cp -R "$ROOT/$d" "$RES/$d"
  echo "  + $d/"
done
echo "Done. Rebuild the Xcode project to pick up changes."
