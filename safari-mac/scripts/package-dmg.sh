#!/bin/bash
#
# package-dmg.sh — turn an exported, notarized "Research Sync.app" into a
# signed + notarized + stapled .dmg with a drag-to-Applications layout.
#
# Prerequisites (one-time, per machine):
#   brew install create-dmg
#   # Create a Developer ID Application certificate for this machine:
#   #   Xcode -> Settings -> Accounts -> Manage Certificates -> + -> Developer ID Application
#   # Store notary credentials in the keychain so notarytool can find them:
#   xcrun notarytool store-credentials "ResearchSyncNotary" \
#       --apple-id "shearm@mac.com" \
#       --team-id "95E9CZ9HW6" \
#       --password "<app-specific-password>"   # from appleid.apple.com
#   # (You can reuse an existing profile from another app instead, e.g.
#   #  NOTARY_PROFILE=BookTrackerNotary, since it's the same Apple ID + team.)
#
# Usage:
#   ./scripts/package-dmg.sh "/path/to/exported/Research Sync.app"
#
# The .app you pass MUST already be Developer-ID signed (i.e. the output of
# Xcode's Organizer -> Distribute App -> Direct Distribution export).

set -euo pipefail

# ---- Config -----------------------------------------------------------------
APP_NAME="Research Sync"
TEAM_ID="95E9CZ9HW6"
NOTARY_PROFILE="${NOTARY_PROFILE:-ResearchSyncNotary}"   # keychain profile name
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKGROUND="$SCRIPT_DIR/assets/dmg-background.png"

APP_PATH="${1:-}"
APP_PATH="${APP_PATH%/}"   # strip trailing slash (AppleScript adds one for bundles,
                          # which makes `cp -R` copy the contents, not the bundle)
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "error: pass the path to your exported ${APP_NAME}.app" >&2
  echo "usage: $0 \"/path/to/${APP_NAME}.app\"" >&2
  exit 1
fi

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "error: create-dmg not found. Install with: brew install create-dmg" >&2
  exit 1
fi

# Resolve the Developer ID identity automatically from the keychain.
# NOTE: the `|| true` is required — under `set -euo pipefail`, an empty grep
# (no Developer ID identity present) makes the pipeline exit non-zero, which
# would abort the script *before* the friendly error below ever prints,
# leaving an empty log. `|| true` lets the [[ -z ]] check do its job.
SIGN_IDENTITY=$(security find-identity -v -p codesigning \
  | grep "Developer ID Application" | head -1 \
  | sed -E 's/.*"(Developer ID Application: .*)"/\1/') || true
if [[ -z "$SIGN_IDENTITY" ]]; then
  echo "error: no 'Developer ID Application' identity found in keychain." >&2
  echo "       Create one via Xcode -> Settings -> Accounts -> Manage" >&2
  echo "       Certificates -> + -> Developer ID Application for team ${TEAM_ID}," >&2
  echo "       then re-run. Check with:" >&2
  echo "         security find-identity -v -p codesigning" >&2
  exit 1
fi
echo "==> Signing identity: $SIGN_IDENTITY"

WORKDIR="$(mktemp -d)"
STAGE="$WORKDIR/stage"
mkdir -p "$STAGE"
cp -R "$APP_PATH" "$STAGE/"
# Normalize the staged bundle to "<APP_NAME>.app" regardless of the export's
# filename, so the xattr/codesign/create-dmg steps all line up.
STAGED_APP="$STAGE/${APP_NAME}.app"
COPIED="$STAGE/$(basename "$APP_PATH")"
[[ "$COPIED" != "$STAGED_APP" ]] && mv "$COPIED" "$STAGED_APP"
if [[ ! -d "$STAGED_APP" ]]; then
  echo "error: couldn't stage the app bundle (got '$COPIED')." >&2
  exit 1
fi
DMG_PATH="$(pwd)/${APP_NAME}.dmg"
rm -f "$DMG_PATH"

# CRITICAL: iCloud Drive tags files with com.apple.FinderInfo / resource-fork
# xattrs that invalidate the code signature ("signature of the binary is
# invalid") and make notarization fail. Strip all detritus, then confirm the
# signature is still valid before we bother building/notarizing.
echo "==> Stripping extended-attribute detritus (iCloud Finder info)..."
xattr -cr "$STAGED_APP"
if ! codesign --verify --deep --strict "$STAGED_APP" 2>/dev/null; then
  echo "error: the app's code signature is not valid after cleanup." >&2
  echo "       Re-export it from Xcode (Distribute App -> Direct Distribution)." >&2
  codesign --verify --deep --strict --verbose=2 "$STAGED_APP" || true
  exit 1
fi
echo "    signature OK."

# Use the app's .icns as the volume icon if present.
VOLICON_ARG=()
ICNS=$(/usr/bin/find "$APP_PATH/Contents/Resources" -maxdepth 1 -name '*.icns' | head -1 || true)
[[ -n "$ICNS" ]] && VOLICON_ARG=(--volicon "$ICNS")

# Use a custom background if present; otherwise build a plain DMG.
# NOTE: a custom background PNG MUST be 144 DPI or macOS stretches it.
BACKGROUND_ARG=()
if [[ -f "$BACKGROUND" ]]; then
  BACKGROUND_ARG=(--background "$BACKGROUND")
else
  echo "warning: no background at $BACKGROUND — building a plain DMG." >&2
fi

echo "==> Building DMG with drag-to-Applications layout..."
set +e
create-dmg \
  --volname "$APP_NAME" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "${APP_NAME}.app" 150 190 \
  --app-drop-link 450 190 \
  "${BACKGROUND_ARG[@]}" \
  "${VOLICON_ARG[@]}" \
  "$DMG_PATH" \
  "$STAGE"
DMG_RESULT=$?
set -e

if [[ $DMG_RESULT -ne 0 || ! -f "$DMG_PATH" ]]; then
  echo "==> Pretty layout failed (usually Finder Automation permission, error -10006)."
  echo "==> Falling back to a plain — but fully notarizable — DMG..."
  # Detach any leftover create-dmg mounts so the fallback can build cleanly.
  for v in /Volumes/dmg.*; do [[ -d "$v" ]] && hdiutil detach "$v" -force >/dev/null 2>&1 || true; done
  rm -f "$DMG_PATH"
  ln -sf /Applications "$STAGE/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG_PATH"
fi

echo "==> Signing the DMG..."
xattr -cr "$DMG_PATH" 2>/dev/null || true
codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_PATH"

echo "==> Submitting DMG for notarization (this can take a few minutes)..."
xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling notarization ticket..."
xcrun stapler staple "$DMG_PATH"

echo "==> Verifying..."
xcrun stapler validate "$DMG_PATH"
spctl -a -vvv -t open --context context:primary-signature "$DMG_PATH" || true

rm -rf "$WORKDIR"
echo ""
echo "Done. Ship it: $DMG_PATH"
