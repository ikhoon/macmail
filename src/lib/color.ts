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
 * On only when: not `--no-color` (color !== false), not `--json`, NO_COLOR
 * unset, and stdout is a TTY (so piped/redirected output stays clean).
 */
export function configureColor(opts: { color?: boolean; json?: boolean } = {}): void {
  enabled =
    opts.color !== false &&
    !opts.json &&
    // NO_COLOR is presence-based (https://no-color.org): any defined value,
    // including an empty string, disables color.
    !('NO_COLOR' in process.env) &&
    Boolean(process.stdout.isTTY);
}

/** Force the flag on/off (for tests). */
export function setColorEnabled(on: boolean): void {
  enabled = on;
}

export function colorIsEnabled(): boolean {
  return enabled;
}

export const dim = wrap('\x1b[2m');
export const bold = wrap('\x1b[1m');
export const yellow = wrap('\x1b[33m');
export const cyan = wrap('\x1b[36m');
export const green = wrap('\x1b[32m');
export const magenta = wrap('\x1b[35m');
export const blue = wrap('\x1b[34m');
