import { describe, it, expect, afterEach } from 'bun:test';
import { formatTriage } from '../../src/commands/triage.ts';
import { setColorEnabled } from '../../src/lib/color.ts';

afterEach(() => setColorEnabled(false));

const ghRow = {
  id: 42,
  sender: 'Copilot <notifications@github.com>',
  subject: '[ikhoon/macmail] Add colored output (PR #6)',
  dateReceived: new Date(2026, 0, 1, 9, 0, 0),
  mailboxUrl: 'imap://me@host/INBOX',
};
const opts = { json: false, account: '', mailbox: 'INBOX', max: 5 };

describe('triage colored output', () => {
  it('colorizes id/sender and linkifies the PR ref when enabled', () => {
    setColorEnabled(true);
    const out = formatTriage([ghRow] as any, opts, []);
    expect(out).toContain('\x1b[93m42\x1b[0m'); // bright yellow id
    expect(out).toContain('\x1b[96mCopilot'); // bright cyan sender (name only)
    expect(out).toContain('https://github.com/ikhoon/macmail/pull/6'); // OSC 8 link
  });

  it('emits no ANSI or links when disabled (pipes / --no-color)', () => {
    setColorEnabled(false);
    const out = formatTriage([ghRow] as any, opts, []);
    expect(out).not.toContain('\x1b');
    expect(out).not.toContain(']8;;');
  });

  it('never colorizes or links JSON output', () => {
    setColorEnabled(true);
    const out = formatTriage([ghRow] as any, { ...opts, json: true }, []);
    expect(out).not.toContain('\x1b');
    expect(out).not.toContain(']8;;');
  });
});
