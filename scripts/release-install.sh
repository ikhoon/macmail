#!/usr/bin/env bash
# Installer bundled inside the macmail release zip. After unzipping, run:
#   ./install.sh
# It clears the download quarantine, places macmail.app under ~/.local/lib, links
# `macmail` onto your PATH, and installs shell completions.
#
# (This is the *binary* installer for downloaded releases. Building from source
# uses the repo's top-level install.sh instead.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="${HERE}/macmail.app"
[ -d "$APP_SRC" ] || { echo "macmail: macmail.app not found next to this script" >&2; exit 1; }

# macmail is ad-hoc signed (not notarized), so a downloaded copy carries
# com.apple.quarantine and Gatekeeper would block it — clear it.
xattr -dr com.apple.quarantine "$APP_SRC" 2>/dev/null || true

APP_DEST="${HOME}/.local/lib/macmail.app"
echo "macmail: installing → ${APP_DEST}"
rm -rf "$APP_DEST"
mkdir -p "${HOME}/.local/lib"
cp -R "$APP_SRC" "$APP_DEST"

BIN="${APP_DEST}/Contents/MacOS/macmail"
mkdir -p "${HOME}/.local/bin"
ln -sf "$BIN" "${HOME}/.local/bin/macmail"
echo "macmail: linked → ${HOME}/.local/bin/macmail"

"$BIN" completions --shell zsh --install 2>/dev/null || true
"$BIN" completions --shell bash --install 2>/dev/null || true

cat <<EOF

Done. Make sure ~/.local/bin is on your PATH:
  which macmail

The first read command (e.g. 'macmail triage') asks for Full Disk Access. In
System Settings → Privacy & Security → Full Disk Access, turn on "macmail" — it
appears by name and icon. Once granted it works from any terminal.
EOF
