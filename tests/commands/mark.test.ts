import { describe, expect, test } from 'bun:test';
import { runMark, formatMarkPreview } from '../../src/commands/mark.ts';
import { autoYesConfirmer, autoNoConfirmer } from '../../src/lib/confirm.ts';

describe('formatMarkPreview', () => {
  test('produces a human-readable single-line summary', () => {
    expect(
      formatMarkPreview({
        account: 'Work',
        mailbox: 'INBOX',
        id: 12345,
        state: 'read',
        dryRun: false,
        yes: false,
      }),
    ).toBe('Mark message 12345 (Work/INBOX) as read');
  });
});

describe('runMark', () => {
  test('--dry-run prints summary without invoking AppleScript', async () => {
    let called = false;
    const out = await runMark(
      {
        account: 'Work',
        mailbox: 'INBOX',
        id: 12345,
        state: 'unread',
        dryRun: true,
        yes: false,
      },
      {
        scriptPath: '/x.applescript',
        runApplescript: () => {
          called = true;
          return '';
        },
        ensureRunning: async () => {
          called = true;
        },
      },
    );
    expect(out).toBe('DRY-RUN: would mark message 12345 (Work/INBOX) as unread\n');
    expect(called).toBe(false);
  });

  test('--yes bypasses confirmation and calls osascript with the right args', async () => {
    let received: { path?: string; args?: string[] } = {};
    let preflight = 0;
    const out = await runMark(
      {
        account: 'Work',
        mailbox: 'INBOX',
        id: 12345,
        state: 'read',
        dryRun: false,
        yes: true,
      },
      {
        scriptPath: '/lib/mark.applescript',
        runApplescript: (path, args) => {
          received = { path, args };
          return 'ok';
        },
        ensureRunning: async () => {
          preflight += 1;
        },
      },
    );
    expect(out).toBe('ok\n');
    expect(received).toEqual({
      path: '/lib/mark.applescript',
      args: ['Work', 'INBOX', '12345', 'read'],
    });
    expect(preflight).toBe(1);
  });

  test('declined confirmation throws aborted, never invokes script', async () => {
    let called = false;
    await expect(
      runMark(
        {
          account: 'Work',
          mailbox: 'INBOX',
          id: 1,
          state: 'read',
          dryRun: false,
          yes: false,
        },
        {
          scriptPath: '/x',
          confirmer: autoNoConfirmer,
          runApplescript: () => {
            called = true;
            return '';
          },
          ensureRunning: async () => {},
        },
      ),
    ).rejects.toThrow(/aborted/);
    expect(called).toBe(false);
  });

  test('explicit confirmer wins over --yes (injected for tests)', async () => {
    let called = false;
    await runMark(
      {
        account: 'L',
        mailbox: 'I',
        id: 9,
        state: 'unread',
        dryRun: false,
        yes: false,
      },
      {
        scriptPath: '/x',
        confirmer: autoYesConfirmer,
        runApplescript: () => {
          called = true;
          return 'ok';
        },
        ensureRunning: async () => {},
      },
    );
    expect(called).toBe(true);
  });
});
