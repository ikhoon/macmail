#!/usr/bin/env bash
# package-release.sh — build the shippable macmail release artifact:
#   dist/macmail-<version>-macos-arm64.zip
#
# Assembles the codesigned macmail.app bundle plus the binary installer and a
# short README, in the exact layout the Homebrew formula and release installer
# expect (a single macmail-<version>/ top-level dir). Runs locally and in CI
# (see .github/workflows/release.yml).
#
# The .app is *ad-hoc* codesigned (codesign --sign -) with the stable identifier
# kr.ikhoon.macmail — no Developer ID / notarization, so this needs no secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="arm64" # macmail is Apple Silicon only for now (see README).

# package.json is the single source of truth for the version (src/cli.ts and the
# smoke test both read it); parse it without a jq/node dependency.
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$VERSION" ] || { echo "package-release: could not read version from package.json" >&2; exit 1; }

STAGE="dist/macmail-${VERSION}"
APP="${STAGE}/macmail.app"
ZIP="dist/macmail-${VERSION}-macos-${ARCH}.zip"

echo "package-release: building macmail ${VERSION} (${ARCH})"

# 1. Compile + ad-hoc codesign the binary (dist/macmail) via the package.json
#    build script, so the codesign identity lives in exactly one place.
mkdir -p dist
bun run build

# 2. Assemble the .app bundle (same layout as install.sh and the shipped zip).
rm -rf "$STAGE"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp dist/macmail "${APP}/Contents/MacOS/macmail"
cp Info.plist "${APP}/Contents/Info.plist"
cp assets/macmail.icns "${APP}/Contents/Resources/macmail.icns"

# Stamp the bundle's version from package.json so the .app metadata matches the
# release (the committed Info.plist is just a template).
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" \
                        -c "Set :CFBundleVersion ${VERSION}" \
                        "${APP}/Contents/Info.plist"

# 3. Codesign the assembled bundle. Stable identifier -> stable Full Disk Access
#    grant. No --options runtime: hardened runtime SIGTRAPs bun:ffi trampolines,
#    and an ad-hoc (non-notarized) bundle gains nothing from it.
codesign --sign - --identifier kr.ikhoon.macmail --force "$APP"

# 4. Drop in the binary installer + a short README for people who download the zip.
cp scripts/release-install.sh "${STAGE}/install.sh"
chmod +x "${STAGE}/install.sh"
cat > "${STAGE}/README.txt" <<EOF
macmail ${VERSION} — a fast macOS Mail.app CLI (Apple Silicon / ${ARCH})

Install:
  ./install.sh
Clears the download quarantine, installs macmail.app to ~/.local/lib, and links
\`macmail\` into ~/.local/bin. Make sure ~/.local/bin is on your PATH.

macmail is ad-hoc signed (not notarized), so macOS flags the download; install.sh
clears it. Manual equivalent:  xattr -dr com.apple.quarantine macmail.app

First read command (e.g. \`macmail triage\`) asks for Full Disk Access — turn on
"macmail" in System Settings > Privacy & Security > Full Disk Access.
EOF

# 5. Zip it. ditto is the macOS-native archiver: it preserves the bundle bit and
#    --keepParent keeps the macmail-<version>/ top-level dir. --norsrc/--noextattr
#    drop resource forks + extended attributes so the archive has no ._* sidecar
#    files (the codesignature lives in the Mach-O and _CodeSignature/, not xattrs).
rm -f "$ZIP"
ditto -c -k --keepParent --norsrc --noextattr "$STAGE" "$ZIP"

echo "package-release: wrote ${ZIP}"
shasum -a 256 "$ZIP"
