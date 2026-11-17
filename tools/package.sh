#!/usr/bin/env bash
# Builds the zip to upload to the Chrome Web Store: dist/ticket-kit-<version>.zip.
# Only the files the browser loads go in. Tests, tools, store material and package.json stay out.
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  manifest.json
  background.js
  menu.html menu.js menu.css
  offscreen.html offscreen.js
  options.html options.js options.css
  lib/format.js lib/inject.js
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
)

version=$(node -p "require('./manifest.json').version")

# Every file the manifest or the pages refer to must be in the list, or the store build breaks.
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "Missing $f" >&2; exit 1; }
done
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const listed = new Set(process.argv.slice(1));
  const wanted = [
    m.background.service_worker, m.options_ui.page,
    ...Object.values(m.icons), ...Object.values(m.action.default_icon),
    ...m.web_accessible_resources.flatMap((w) => w.resources),
  ];
  for (const page of ["menu.html", "options.html", "offscreen.html"]) {
    for (const [, ref] of fs.readFileSync(page, "utf8").matchAll(/(?:src|href)="([^":#]+)"/g)) wanted.push(ref);
  }
  for (const js of ["background.js", "menu.js", "options.js"]) {
    for (const [, , ref] of fs.readFileSync(js, "utf8").matchAll(/from (["\x27])\.\/([^"\x27]+)\1/g)) wanted.push(ref);
  }
  const missing = [...new Set(wanted)].filter((f) => !listed.has(f));
  if (missing.length) { console.error("Referenced but not packaged: " + missing.join(", ")); process.exit(1); }
' "${FILES[@]}"

mkdir -p dist
out="dist/ticket-kit-${version}.zip"
rm -f "$out"
zip -q -X "$out" "${FILES[@]}"
echo "Built $out ($(du -h "$out" | cut -f1 | tr -d ' '), ${#FILES[@]} files)"
