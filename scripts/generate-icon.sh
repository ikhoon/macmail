#!/usr/bin/env bash
# generate-icon.sh — render assets/macmail.icns: a dark terminal-window squircle
# (traffic-light title bar) with a big "@" — mail (@) + CLI identity. Used as the
# .app bundle icon shown in System Settings → Full Disk Access. macOS only; needs
# swift, sips, and iconutil.
#
#   ./scripts/generate-icon.sh            # white @ on a dark terminal window
#   ./scripts/generate-icon.sh at 30D158  # tint the glyph (terminal green)
#   ./scripts/generate-icon.sh terminal.fill   # a different SF Symbol glyph
#
# The .icns is committed, so install.sh needs no icon toolchain — re-run this
# only to change the icon.
set -euo pipefail

GLYPH="${1:-at}"
GLYPH_HEX="${2:-FFFFFF}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ICNS="${SCRIPT_DIR}/../assets/macmail.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ICON_GLYPH="$GLYPH" ICON_GLYPH_HEX="$GLYPH_HEX" ICON_OUT="${TMP}/base.png" swift - <<'SWIFT'
import AppKit
import Foundation

let env = ProcessInfo.processInfo.environment
let glyph = env["ICON_GLYPH"] ?? "at"
let out = env["ICON_OUT"]!
let px: CGFloat = 1024

func color(_ hex: String) -> NSColor {
  let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  var v: UInt64 = 0; Scanner(string: s).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255,
                 green: CGFloat((v >> 8) & 0xff) / 255,
                 blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

let image = NSImage(size: NSSize(width: px, height: px))
image.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high

// Squircle = the terminal window. Dark charcoal gradient.
let margin: CGFloat = 88
let rect = NSRect(x: margin, y: margin, width: px - 2 * margin, height: px - 2 * margin)
let r = rect.width * 0.2237
let squircle = NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r)
NSGraphicsContext.saveGraphicsState()
squircle.addClip()
NSGradient(starting: color("1C1C1E"), ending: color("3A3A3C"))!.draw(in: rect, angle: 90)
NSGraphicsContext.restoreGraphicsState()

// Title-bar traffic lights (top-left).
let dotR: CGFloat = 27
let dotY = rect.maxY - 100
for (i, c) in [color("FF5F57"), color("FEBC2E"), color("28C840")].enumerated() {
  c.set()
  let cx = rect.minX + 92 + CGFloat(i) * 80
  NSBezierPath(ovalIn: NSRect(x: cx - dotR, y: dotY - dotR, width: 2 * dotR, height: 2 * dotR)).fill()
}

// Big glyph ("@"), centered in the window body (below the title bar). Render
// large then downscale so edges stay crisp.
let cfg = NSImage.SymbolConfiguration(pointSize: 720, weight: .bold)
guard let sym = NSImage(systemSymbolName: glyph, accessibilityDescription: nil)?.withSymbolConfiguration(cfg) else {
  FileHandle.standardError.write(Data("generate-icon: unknown SF Symbol '\(glyph)'\n".utf8))
  exit(1)
}
let tint = color(env["ICON_GLYPH_HEX"] ?? "FFFFFF")
let tinted = NSImage(size: sym.size)
tinted.lockFocus()
sym.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1)
tint.set()
NSRect(origin: .zero, size: sym.size).fill(using: .sourceAtop)
tinted.unlockFocus()
let w = px * 0.50
let h = w * sym.size.height / sym.size.width
tinted.draw(in: NSRect(x: (px - w) / 2, y: px * 0.42 - h / 2, width: w, height: h))

image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
SWIFT

# Down-sample to every icon size, then compile to .icns.
ICONSET="${TMP}/macmail.iconset"
mkdir -p "$ICONSET"
for spec in 16:16x16 32:16x16@2x 32:32x32 64:32x32@2x 128:128x128 \
            256:128x128@2x 256:256x256 512:256x256@2x 512:512x512 1024:512x512@2x; do
  size="${spec%%:*}"; name="${spec##*:}"
  sips -z "$size" "$size" "${TMP}/base.png" --out "${ICONSET}/icon_${name}.png" >/dev/null
done
mkdir -p "$(dirname "$OUT_ICNS")"
iconutil -c icns "$ICONSET" -o "$OUT_ICNS"
echo "macmail: wrote ${OUT_ICNS} (terminal window + ${GLYPH})"
