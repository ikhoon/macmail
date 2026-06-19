// completions.ts — `macmail completions`: print the shell completion script, or
// install it with --install. The zsh/bash scripts are embedded at build time
// (Bun's `with { type: 'text' }`) so a standalone binary can set up its own
// completion without install.sh or the source tree present.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import zshCompletion from '../../completions/_macmail' with { type: 'text' };
import bashCompletion from '../../completions/macmail.bash' with { type: 'text' };

export type CompletionShell = 'zsh' | 'bash';

export interface CompletionsOptions {
  /** Explicit --shell; defaults to the basename of $SHELL. */
  shell?: string;
  /** Write to the standard location instead of printing to stdout. */
  install: boolean;
}

const SCRIPTS: Record<CompletionShell, string> = {
  zsh: zshCompletion,
  bash: bashCompletion,
};

/** $XDG_DATA_HOME, or ~/.local/share when unset — the per-user data root. */
function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

/** Standard per-user install path for a shell's completion script. */
function installTarget(shell: CompletionShell): { dir: string; file: string } {
  const dataHome = xdgDataHome();
  return shell === 'zsh'
    ? { dir: join(dataHome, 'zsh', 'site-functions'), file: '_macmail' }
    : { dir: join(dataHome, 'bash-completion', 'completions'), file: 'macmail' };
}

/**
 * Resolve the target shell, then either return the completion script (to print)
 * or install it and return the confirmation + enablement instructions. Throws
 * on an unsupported shell — macmail ships zsh/bash completions only (no fish).
 */
export function runCompletions(opts: CompletionsOptions): string {
  const name = opts.shell ?? basename(process.env.SHELL ?? 'zsh');
  if (name !== 'zsh' && name !== 'bash') {
    throw new Error(`completions: unsupported shell '${name}' (use zsh|bash)`);
  }
  const script = SCRIPTS[name];

  if (!opts.install) {
    // Printed for `source <(macmail completions --shell zsh)`.
    return script.endsWith('\n') ? script : `${script}\n`;
  }

  const { dir, file } = installTarget(name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  // Replace any prior file/symlink (install.sh used to symlink here) so the
  // installed completion is a self-contained copy, not a link into the repo.
  rmSync(path, { force: true });
  writeFileSync(path, script);

  const lines = [`macmail: ${name} completion installed → ${path}`];
  if (name === 'zsh') {
    lines.push('  Enable it by adding to ~/.zshrc before compinit:');
    lines.push(`      fpath=(${dir} $fpath)`);
    lines.push('  then open a new shell.');
  } else {
    lines.push('  bash-completion loads this automatically in new shells.');
  }
  return `${lines.join('\n')}\n`;
}
