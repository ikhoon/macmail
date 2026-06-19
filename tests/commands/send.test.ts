import { describe, expect, test } from 'bun:test';
import { runSend } from '../../src/commands/send.ts';
import { autoYesConfirmer, autoNoConfirmer } from '../../src/lib/confirm.ts';

const baseOpts = {
  to: 'alice@example.com',
  subject: 'Hi',
  body: 'Hello there.',
  cc: '',
  bcc: '',
  draft: false,
  dryRun: false,
  yes: false,
};

describe('runSend', () => {
  test('throws on missing --to / --subject / --body', async () => {
    await expect(
      runSend({ ...baseOpts, to: '' }, { scriptPath: '/x' }),
    ).rejects.toThrow(/--to/);
    await expect(
      runSend({ ...baseOpts, subject: '' }, { scriptPath: '/x' }),
    ).rejects.toThrow(/--subject/);
    await expect(
      runSend({ ...baseOpts, body: '' }, { scriptPath: '/x' }),
    ).rejects.toThrow(/--body/);
  });

  test('--dry-run prints summary without invoking AppleScript', async () => {
    let called = false;
    const out = await runSend(
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
    expect(out).toContain('DRY-RUN: would send');
    expect(out).toContain('To:      alice@example.com');
    expect(out).toContain('Subject: Hi');
    expect(out).toContain('Hello there.');
    expect(called).toBe(false);
  });

  test('--dry-run for --draft says "draft"', async () => {
    const out = await runSend(
      { ...baseOpts, dryRun: true, draft: true },
      { scriptPath: '/x' },
    );
    expect(out).toContain('DRY-RUN: would create draft');
  });

  test('with --yes calls AppleScript with positional args', async () => {
    let args: string[] = [];
    await runSend(
      { ...baseOpts, yes: true, cc: 'cc@x.com', bcc: 'bcc@x.com', draft: false },
      {
        scriptPath: '/send.applescript',
        runApplescript: (_, a) => {
          args = a;
          return 'ok';
        },
        ensureRunning: async () => {},
      },
    );
    expect(args).toEqual([
      'alice@example.com',
      'Hi',
      'Hello there.',
      'cc@x.com',
      'bcc@x.com',
      '0', // draft=false
    ]);
  });

  test('declined confirmation throws aborted', async () => {
    let called = false;
    await expect(
      runSend(baseOpts, {
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
