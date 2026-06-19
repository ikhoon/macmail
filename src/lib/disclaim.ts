// disclaim.ts — re-exec macmail as its own TCC "responsible process" so Full
// Disk Access is attributed to the macmail binary (its code signature) instead
// of the terminal that launched it. Port of maccal's reexecWithDisclaim.
//
// A CLI launched from a terminal inherits the TERMINAL's FDA grant — TCC's
// "responsible process" is the terminal. So macmail only worked in terminals
// that themselves had FDA, and never appeared in System Settings → Full Disk
// Access under its own name (you had to click "+" and add the binary by path).
// After disclaiming, the re-exec'd process is its own responsible process:
// macOS attributes the ~/Library/Mail read to "macmail" (codesign identifier
// kr.ikhoon.macmail), so it shows up in the FDA list to toggle on — no "+", no
// path picking — and the grant then works from every terminal.
//
// Mechanism (the same private libSystem entry point maccal uses, via bun:ffi):
//   posix_spawnattr_init → responsibility_spawnattrs_setdisclaim(attr, 1)
//   → posix_spawnattr_setflags(POSIX_SPAWN_SETEXEC) → posix_spawn(self)
// SETEXEC replaces this process image in place (argv / stdio / exit preserved),
// a transparent self-bootstrap. Any failure (e.g. the private symbol is missing)
// silently falls back to running normally — i.e. inheriting the terminal's
// grant, exactly as before.

import { dlopen, FFIType, ptr } from 'bun:ffi';
import { writeSync } from 'node:fs';

// Make posix_spawn replace this image instead of forking a child.
const POSIX_SPAWN_SETEXEC = 0x0040;

// Only the read commands touch ~/Library/Mail and need FDA. Write commands go
// through Mail.app (Automation — a different TCC bucket) and the meta commands
// (completions / help / version) need nothing, so we disclaim only where it
// helps: no disturbing the automation path, no extra exec on shell-startup
// `source <(macmail completions …)`.
const FDA_COMMANDS = new Set(['accounts', 'mailboxes', 'triage', 'search', 'read']);

function debug(msg: string): void {
  if (process.env.MACMAIL_DEBUG_DISCLAIM === '1') {
    // Synchronous: posix_spawn(SETEXEC) replaces this image immediately, so a
    // buffered async write could be lost.
    writeSync(2, `macmail[disclaim]: ${msg}\n`);
  }
}

/**
 * Re-exec macmail once with TCC responsibility disclaimed (macOS only). No-op
 * unless invoked as the compiled binary running an FDA-needing subcommand, and
 * a no-op on re-entry (guarded by MACMAIL_DISCLAIMED). Never throws.
 */
export function reexecWithDisclaim(): void {
  if (process.platform !== 'darwin') return;
  if (process.env.MACMAIL_DISCLAIMED === '1') return; // already re-exec'd
  if (process.env.MACMAIL_NO_DISCLAIM === '1') {
    debug('skipped (MACMAIL_NO_DISCLAIM=1)');
    return;
  }
  // Only act in the compiled standalone binary, where Bun embeds the entry under
  // /$bunfs/ and lays out argv as ["bun", "/$bunfs/root/<bin>", <subcommand>, …].
  // Under `bun run src/cli.ts …` (dev) argv[1] is the real script path, so this
  // naturally no-ops during development.
  if (!process.argv[1]?.startsWith('/$bunfs/')) return;
  const sub = process.argv[2]; // first user argument
  if (!sub || !FDA_COMMANDS.has(sub)) return;

  try {
    const { symbols } = dlopen('/usr/lib/libSystem.B.dylib', {
      posix_spawnattr_init: { args: [FFIType.ptr], returns: FFIType.i32 },
      posix_spawnattr_setflags: { args: [FFIType.ptr, FFIType.i16], returns: FFIType.i32 },
      responsibility_spawnattrs_setdisclaim: {
        args: [FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      posix_spawn: {
        args: [
          FFIType.ptr, // pid_t *pid
          FFIType.ptr, // const char *path
          FFIType.ptr, // const posix_spawn_file_actions_t *
          FFIType.ptr, // const posix_spawnattr_t *
          FFIType.ptr, // char *const argv[]
          FFIType.ptr, // char *const envp[]
        ],
        returns: FFIType.i32,
      },
    });

    // posix_spawnattr_t is a void*; pass a pointer to an 8-byte slot (void**).
    const attr = new BigUint64Array(1);
    if (symbols.posix_spawnattr_init(attr) !== 0) {
      debug('posix_spawnattr_init failed');
      return;
    }
    if (symbols.responsibility_spawnattrs_setdisclaim(attr, 1) !== 0) {
      debug('setdisclaim failed');
      return;
    }
    symbols.posix_spawnattr_setflags(attr, POSIX_SPAWN_SETEXEC);

    // NULL-terminated char* arrays for argv/envp. Hold the encoded C-string
    // buffers in `keep` so they aren't GC'd before posix_spawn reads them.
    const keep: Uint8Array[] = [];
    const cArray = (items: string[]): BigUint64Array => {
      const out = new BigUint64Array(items.length + 1);
      for (let i = 0; i < items.length; i++) {
        const buf = new TextEncoder().encode(`${items[i]}\0`);
        keep.push(buf);
        out[i] = BigInt(ptr(buf));
      }
      out[items.length] = 0n; // NULL terminator
      return out;
    };

    // Reconstruct the OS-level argv ([binary, …userArgs]); Bun's process.argv
    // injects "bun" and the /$bunfs/ entry path, which must not be passed through.
    const argv = cArray([process.execPath, ...process.argv.slice(2)]);
    const env = Object.entries(process.env)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${v}`);
    env.push('MACMAIL_DISCLAIMED=1');
    const envp = cArray(env);

    const path = new TextEncoder().encode(`${process.execPath}\0`);
    keep.push(path);

    debug(`re-exec ${process.execPath}`);
    // pid = NULL, file_actions = NULL. On success SETEXEC never returns.
    symbols.posix_spawn(null, path, null, attr, argv, envp);
    // Keep the C-string buffers referenced until after the call.
    void keep;
    debug('posix_spawn returned — falling back to inherited grant');
  } catch (err) {
    debug(`unavailable (${(err as Error)?.message ?? String(err)}) — inheriting terminal grant`);
  }
}
