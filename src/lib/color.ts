// color.ts — subtle ANSI styling for human (text) output.
//
// Color is ON by default and opt-out: enabled when stdout is a TTY, and turned
// off for pipes / redirects / `--json`, or when `--no-color` or the NO_COLOR
// env var (https://no-color.org) is set. The style helpers no-op unless color
// is enabled, so callers wrap unconditionally: `dim(date)`, `yellow('DRY-RUN')`.

let enabled = false;

const RESET = '\x1b[0m';
const wrap =
  (open: string) =>
  (s: string): string =>
    enabled && s ? `${open}${s}${RESET}` : s;

/**
 * Decide whether to colorize, once per command before output.
 * `--no-color` (color === false), `NO_COLOR`, and `--json` force it OFF. Then
 * `mode` (from the config file) decides: "always" → on, "never" → off,
 * "auto"/unset → on only when stdout is a TTY (piped/redirected stays clean).
 */
export function configureColor(
  opts: { color?: boolean; json?: boolean; mode?: string } = {},
): void {
  // NO_COLOR is presence-based (https://no-color.org): any defined value,
  // including an empty string, disables color.
  if (opts.color === false || opts.json || 'NO_COLOR' in process.env) {
    enabled = false;
    return;
  }
  const mode = (opts.mode ?? 'auto').toLowerCase();
  enabled = mode === 'always' ? true : mode === 'never' ? false : Boolean(process.stdout.isTTY);
}

/** Force the flag on/off (for tests). */
export function setColorEnabled(on: boolean): void {
  enabled = on;
}

export function colorIsEnabled(): boolean {
  return enabled;
}

export const bold = wrap('\x1b[1m');
// Subtle link affordance: a dotted underline (SGR 4:4 — degrades to a plain
// underline on terminals that don't support the extended style) in a soft blue
// (256-color 110). Uses off-codes (24 underline, 39 default fg) rather than a
// full reset so it nests inside bold/color. Marks clickable links unobtrusively.
export const linkText = (s: string): string =>
  enabled && s ? `\x1b[4:4;38;5;110m${s}\x1b[24;39m` : s;
// Secondary text: bright-black (a readable gray) rather than SGR 2 "faint",
// which many terminals render as washed-out/low-contrast.
export const dim = wrap('\x1b[90m');
// Bright (90–97) foregrounds — more legible on dark terminals than the muted
// 30–37 set.
export const yellow = wrap('\x1b[93m');
export const cyan = wrap('\x1b[96m');
export const green = wrap('\x1b[92m');
export const magenta = wrap('\x1b[95m');
export const blue = wrap('\x1b[94m');
