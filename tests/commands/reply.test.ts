import { describe, expect, test } from 'bun:test';
import { runReply } from '../../src/commands/reply.ts';
import { autoYesConfirmer, autoNoConfirmer } from '../../src/lib/confirm.ts';

const baseOpts = {
  account: 'Work',
  mailbox: 'INBOX',
  id: 12345,
  body: 'Thanks for the heads up.',
  all: false,
  draft: false,
  dryRun: false,
  yes: false,
};

describe('runReply', () => {
  test('throws on missing --body', async () => {
    await expect(
      runReply({ ...baseOpts, body: '' }, { scriptPath: '/x' }),
    ).rejects.toThrow(/--body/);
  });

  test('--dry-run prints summary including body and target, no AppleScript', async () => {
    let called = false;
    const out = await runReply(
      { ...baseOpts, dryRun: true },
      {
        scriptPath: '/x',
        runApplescript: () => {
          called = true;
          return '';
        },
        ensureRunning: async () => {
          called = true;
        },
      },
    );
    expect(out).toContain('DRY-RUN: would send reply');
    expect(out).toContain('Target:  message 12345 (Work/INBOX)');
    expect(out).toContain('Mode:    reply');
    expect(out).toContain('Thanks for the heads up.');
    expect(called).toBe(false);
  });

  test('--all switches mode to reply-all', async () => {
    const out = await runReply(
      { ...baseOpts, dryRun: true, all: true },
      { scriptPath: '/x' },
    );
    expect(out).toContain('Mode:    reply-all');
    expect(out).toContain('DRY-RUN: would send reply-all');
  });

  test('--draft + --all dry-run says "draft reply-all"', async () => {
    const out = await runReply(
      { ...baseOpts, dryRun: true, all: true, draft: true },
      { scriptPath: '/x' },
    );
    expect(out).toContain('DRY-RUN: would draft reply-all');
  });

  test('with --yes calls AppleScript with positional args in canonical order', async () => {
    let args: string[] = [];
    await runReply(
      { ...baseOpts, yes: true, all: true, draft: false },
      {
        scriptPath: '/reply.applescript',
        runApplescript: (_, a) => {
          args = a;
          return 'ok';
        },
        ensureRunning: async () => {},
      },
    );
    expect(args).toEqual([
      'Work',
      'INBOX',
      '12345',
      'Thanks for the heads up.',
      '1', // all=true
      '0', // draft=false
    ]);
  });

  test('declined confirmation throws aborted', async () => {
    let called = false;
    await expect(
      runReply(baseOpts, {
        scriptPath: '/x',
        confirmer: autoNoConfirmer,
        runApplescript: () => {
          called = true;
          return '';
        },
        ensureRunning: async () => {},
      }),
    ).rejects.toThrow(/aborted/);
    expect(called).toBe(false);
  });
});
