#!/usr/bin/env bash
# Renders the Chrome Web Store images into store/images/ with headless Chrome:
#   screenshot-1..5.png  1280x800, the real menu files over a stand-in ticket page (made-up tickets)
#   promo-small.png      440x280 small promo tile
# Needs Google Chrome and python3. Run after UI changes: npm run screenshots
set -euo pipefail

cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8791}"
OUT=store/images
mkdir -p "$OUT"

# The menu page with the API stand-in loaded first, so menu.js runs unchanged.
sed -e 's#href="menu.css"#href="../../menu.css"#' \
    -e 's#<script type="module" src="menu.js"></script>#<script src="stub.js"></script><script type="module" src="../../menu.js"></script>#' \
    menu.html > store/shots/menu-frame.html

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
server=$!
profile=$(mktemp -d)
trap 'kill $server 2>/dev/null; rm -rf "$profile" store/shots/menu-frame.html' EXIT
sleep 1

shoot() { # url out width height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$profile" \
    --force-device-scale-factor=1 --force-prefers-reduced-motion --blink-settings=preferredColorScheme=1 --window-size="$3,$4" --virtual-time-budget=4000 \
    --screenshot="$PWD/$2" "$1" >/dev/null 2>&1
  echo "wrote $2"
}

n=1
for scene in menu filter branch pr copied; do
  shoot "http://127.0.0.1:$PORT/store/shots/shot.html?scene=$scene" "$OUT/screenshot-$n.png" 1280 800
  n=$((n + 1))
done
shoot "http://127.0.0.1:$PORT/store/shots/promo.html" "$OUT/promo-small.png" 440 280
