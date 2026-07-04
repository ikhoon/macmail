// osascript.ts — invoke AppleScript files and run Mail.app preflight/FDA helpers.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIL_BIN_REGEX = '/MacOS/Mail$';

export function runAppleScript(scriptPath: string, args: string[] = []): string {
  return execFileSync('osascript', [scriptPath, ...args], {
    encoding: 'utf-8',
  });
}

/** Run inline AppleScript text by writing to a temp file (so `argv` works). */
export function runAppleScriptInline(content: string, args: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'macmail-as-'));
  const path = join(dir, 'script.applescript');
  try {
    writeFileSync(path, content);
    return runAppleScript(path, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function isMailRunning(): boolean {
  try {
    execFileSync('pgrep', ['-f', MAIL_BIN_REGEX], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function ensureMailRunning(opts?: {
  timeoutMs?: number;
  log?: (msg: string) => void;
}): Promise<void> {
  if (process.env.MACMAIL_NO_LAUNCH === '1') return;
  if (isMailRunning()) return;
  (opts?.log ?? ((m) => process.stderr.write(`${m}\n`)))('macmail: Mail.app not running — launching...');
  execFileSync('open', ['-a', 'Mail']);
  const deadline = Date.now() + (opts?.timeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    if (isMailRunning()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Mail.app failed to launch within timeout');
}

export function canReadMailDir(): boolean {
  const dir = join(homedir(), 'Library', 'Mail');
  if (!existsSync(dir)) return false;
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** Escape a string for safe inclusion inside an AppleScript double-quoted
 *  literal (only `"` and `\` need escaping there). */
function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The path to add in Full Disk Access. When macmail runs from its .app bundle
 *  (…/macmail.app/Contents/MacOS/macmail) this is the *bundle* — adding that
 *  gives the named, iconed "macmail" entry; adding the inner Mach-O instead
 *  registers a generic, icon-less binary entry. Falls back to the executable
 *  for a bare-binary install. */
export function fdaGrantTarget(): string {
  const m = process.execPath.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : process.execPath;
}

/** Build a one-shot AppleScript that shows the FDA dialog with the path the
 *  user should add in Privacy → Full Disk Access (the .app bundle when bundled).
 *  The grant follows macmail itself, so it works from any terminal
 *  (Terminal.app, iTerm, cmux, Warp, VS Code's integrated terminal, …). */
function buildFdaDialogScript(iconClause: string): string {
  return `try
  set msg to "macmail needs Full Disk Access to read your mail (~/Library/Mail).

Click \\"Open Settings\\", then switch \\"macmail\\" on in the list — it shows this icon.

One-time: the grant follows macmail, so every terminal works."
  set btn to button returned of (display dialog msg buttons {"Cancel", "Open Settings"} default button "Open Settings" with title "macmail — Full Disk Access" with icon ${iconClause})
  return btn
on error
  return "Cancel"
end try
`;
}

/** AppleScript `with icon` clause: macmail's own app icon when running from the
 *  bundle (so the dialog shows the same icon to look for in the list), else the
 *  generic caution icon. */
function fdaDialogIconClause(): string {
  const target = fdaGrantTarget();
  if (target.endsWith('.app')) {
    const icns = join(target, 'Contents', 'Resources', 'macmail.icns');
    if (existsSync(icns)) return `(POSIX file "${escapeForAppleScript(icns)}")`;
  }
  return 'caution';
}

/**
 * Show a native dialog explaining FDA is needed; on confirmation, open
 * System Settings to the Full Disk Access pane. Returns true if the user
 * clicked "Open Settings".
 *
 * Skipped (returns false without showing dialog) when stderr isn't a TTY or
 * MACMAIL_NO_FDA_PROMPT=1 is set, so CI / piped invocations / background
 * agents don't deadlock on an unattended modal.
 */
export function promptFullDiskAccess(opts?: { force?: boolean }): boolean {
  if (!opts?.force) {
    if (process.env.MACMAIL_NO_FDA_PROMPT === '1') return false;
    if (!process.stderr.isTTY) return false;
  }
  try {
    const script = buildFdaDialogScript(fdaDialogIconClause());
    const out = execFileSync('osascript', ['-e', script], {
      encoding: 'utf-8',
    }).trim();
    if (out === 'Open Settings') {
      execFileSync('open', [
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      ]);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
