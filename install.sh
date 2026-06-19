#!/usr/bin/env bash
# install.sh — build the macmail TypeScript binary and symlink it (plus
# shell completions) into ~/.local/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# === Prerequisites ===
if ! command -v bun >/dev/null 2>&1; then
  echo "macmail: bun not found. Install with:"
  echo "  brew install bun"
  echo "or:"
  echo "  curl -fsSL https://bun.sh/install | bash"
  exit 127
fi

# === Build ===
echo "macmail: installing dependencies (bun install)..."
bun install --silent

echo "macmail: compiling + codesigning binary (bun run build)..."
mkdir -p dist
# Use the package.json build script so the binary is codesigned with the stable
# identifier (kr.ikhoon.macmail). A plain `bun build --compile` produces an
# unsigned `a.out`-identified binary, which breaks the Full Disk Access grant on
# every reinstall — keep this in sync with the "build" script in package.json.
bun run build

# === Assemble the .app bundle ===
# Packaging macmail.app (rather than a bare binary) makes it appear in System
# Settings → Full Disk Access by name and icon. Pairs with the TCC disclaim in
# src/lib/disclaim.ts, which makes macmail — not the terminal — the responsible
# process, so the grant is keyed to this bundle.
SRC="${SCRIPT_DIR}/dist/macmail"
APP_DIR="${HOME}/.local/lib/macmail.app"
MACOS_DIR="${APP_DIR}/Contents/MacOS"
RES_DIR="${APP_DIR}/Contents/Resources"

echo "macmail: packaging ${APP_DIR}..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR"
cp "$SRC" "${MACOS_DIR}/macmail"
cp "${SCRIPT_DIR}/Info.plist" "${APP_DIR}/Contents/Info.plist"
cp "${SCRIPT_DIR}/assets/macmail.icns" "${RES_DIR}/macmail.icns"

# === Codesign the bundle ===
# Stable identifier → the FDA grant is keyed on macmail. No --options runtime:
# hardened runtime SIGTRAPs bun:ffi's call trampolines, and an ad-hoc local
# binary isn't notarized, so it buys nothing.
echo "macmail: codesigning macmail.app (kr.ikhoon.macmail)..."
codesign --sign - --identifier kr.ikhoon.macmail --force "$APP_DIR"

# === Symlink the bundle's executable onto PATH ===
BIN_DIR="${HOME}/.local/bin"
DEST="${BIN_DIR}/macmail"
BIN="${MACOS_DIR}/macmail"
mkdir -p "$BIN_DIR"
if [[ -L "$DEST" || -e "$DEST" ]]; then
  echo "macmail: $DEST already exists; replacing"
  rm -f "$DEST"
fi
ln -s "$BIN" "$DEST"
echo "macmail: installed → $DEST → $BIN"

# === Install completions ===
# Delegate to the freshly built binary so install.sh and a binary-only setup
# (`macmail completions --install`) share one code path. The completion scripts
# are embedded in the binary at build time.
"$BIN" completions --shell zsh --install
"$BIN" completions --shell bash --install

cat <<EOF

Verify:
  which macmail
  macmail --help

Shell completion was installed above (each shell printed how to enable it).
Re-run any time with:  macmail completions --install

First read subcommand will prompt for Full Disk Access if not already granted.
In the Settings window, turn on "macmail" in the Full Disk Access list — it
appears by name and icon. (If it isn't listed, click + and add the .app — not
the inner binary: $APP_DIR)
EOF
