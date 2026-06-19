// Local-only integration tests.
//
// These run macmail against the REAL ~/Library/Mail store, so they need Full
// Disk Access and a populated mailbox — they can't run in CI. They live under
// tests/local/, which `bun test` (the default / CI script) excludes via
// --path-ignore-patterns. Run them with:
//
//   bun run test:local
//
// If Full Disk Access isn't granted, the suite is skipped (not failed).

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { canReadMailDir } from '../../src/lib/osascript.ts';

const CLI = join(import.meta.dir, '..', '..', 'src', 'cli.ts');
const run = (...args: string[]) =>
  execFileSync('bun', ['run', CLI, ...args], { encoding: 'utf-8' });

describe.skipIf(!canReadMailDir())(
  'real Mail store (local only — needs Full Disk Access)',
  () => {
    test('accounts lists at least one configured account', () => {
      expect(run('accounts').trim().length).toBeGreaterThan(0);
    });

    test('triage --json runs and emits valid NDJSON (or nothing)', () => {
      const out = run('triage', '--max', '1', '--json').trim();
      if (out) {
        for (const line of out.split('\n')) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      }
    });
  },
);
