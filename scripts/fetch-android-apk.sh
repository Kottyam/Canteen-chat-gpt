#!/usr/bin/env bash
# Downloads the public signed APK into public/ so Vite serves it at /GoCanteen.apk.
# Not committed to git — runs on every web build (e.g. Vercel). Skipped for Capacitor Android CI.
set -euo pipefail

if [ "${VITE_CAPACITOR_ANDROID_BUILD:-}" = "true" ] || [ "${SKIP_APK_FETCH:-}" = "1" ]; then
  echo "Skipping GoCanteen.apk fetch (native/Capacitor build)."
  exit 0
fi

URL="${GOCANTEEN_APK_URL:-https://github.com/Kottyam/Canteen-chat-gpt/releases/latest/download/GoCanteen.apk}"
OUT="public/GoCanteen.apk"
mkdir -p public
TMP="$(mktemp "${TMPDIR:-/tmp}/GoCanteen.apk.XXXXXX")"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

echo "Downloading GoCanteen.apk from ${URL} ..."
if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 30 -o "$TMP" "$URL"; then
  echo "ERROR: Failed to download Android APK from ${URL}" >&2
  echo "Create/update the android-latest GitHub Release asset GoCanteen.apk, then rebuild." >&2
  exit 1
fi

# APK files are ZIP archives (magic "PK")
MAGIC="$(head -c 2 "$TMP" || true)"
if [ "$MAGIC" != "PK" ]; then
  echo "ERROR: Downloaded file is not an APK (expected ZIP/APK magic 'PK')." >&2
  exit 1
fi

SIZE="$(wc -c < "$TMP" | tr -d ' ')"
if [ "$SIZE" -lt 1000000 ]; then
  echo "ERROR: Downloaded APK is suspiciously small (${SIZE} bytes)." >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT
echo "Saved ${OUT} (${SIZE} bytes) — served at /GoCanteen.apk"
