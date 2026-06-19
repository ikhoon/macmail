import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompletions } from '../../src/commands/completions.ts';

describe('completions command', () => {
  const savedShell = process.env.SHELL;
  const savedXdg = process.env.XDG_DATA_HOME;

  afterEach(() => {
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
  });

  test('prints the embedded zsh script for --shell zsh', () => {
    const out = runCompletions({ shell: 'zsh', install: false });
    expect(out).toContain('#compdef macmail');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('prints the embedded bash script for --shell bash', () => {
    const out = runCompletions({ shell: 'bash', install: false });
    expect(out).toContain('complete -F _macmail_complete macmail');
  });

  test('defaults the shell to the basename of $SHELL', () => {
    process.env.SHELL = '/opt/homebrew/bin/bash';
    const out = runCompletions({ install: false });
    expect(out).toContain('complete -F _macmail_complete macmail');
  });

  test('throws on an unsupported shell (no fish completion shipped)', () => {
    expect(() => runCompletions({ shell: 'fish', install: false })).toThrow(
      /unsupported shell 'fish'/,
    );
  });

  test('--install writes the zsh script under XDG_DATA_HOME and prints the fpath hint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macmail-comp-'));
    process.env.XDG_DATA_HOME = dir;
    try {
      const out = runCompletions({ shell: 'zsh', install: true });
      const siteFns = join(dir, 'zsh', 'site-functions');
      const dest = join(siteFns, '_macmail');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toContain('#compdef macmail');
      expect(out).toContain(dest);
      expect(out).toContain(`fpath=(${siteFns} $fpath)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--install writes the bash script and notes auto-loading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macmail-comp-'));
    process.env.XDG_DATA_HOME = dir;
    try {
      const out = runCompletions({ shell: 'bash', install: true });
      const dest = join(dir, 'bash-completion', 'completions', 'macmail');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toContain('complete -F _macmail_complete');
      expect(out).toContain('bash-completion loads this automatically');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
