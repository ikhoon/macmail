import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EnvelopeIndex } from '../../src/lib/envelope.ts';
import { runMailboxes, shortMailboxName } from '../../src/commands/mailboxes.ts';
import { buildEnvelopeFixture } from '../helpers/envelope-fixture.ts';

describe('shortMailboxName', () => {
  test('strips imap://user@host/ prefix', () => {
    expect(shortMailboxName('imap://user@gmail.com/INBOX')).toBe('INBOX');
    expect(shortMailboxName('imap://other@icloud.com/[Gmail]/All%20Mail')).toBe(
      '[Gmail]/All Mail',
    );
  });
  test('returns input unchanged for non-URL strings', () => {
    expect(shortMailboxName('not-a-url')).toBe('not-a-url');
  });
});

describe('mailboxes command', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildEnvelopeFixture());
  });
  afterAll(() => env.close());

  test('text mode emits one short mailbox name per line', () => {
    const out = runMailboxes(env, { json: false });
    // URLs sort ASCII: '/I' (0x49) < '/[' (0x5B), so gview/INBOX precedes
    // gview/[Gmail]/All Mail. Final order:
    //   gview@gmail/INBOX, gview@gmail/[Gmail]/All Mail,
    //   other@icloud/INBOX, user@gmail/INBOX, user@gmail/JIRA.
    expect(out).toBe(
      'INBOX\n[Gmail]/All Mail\nINBOX\nINBOX\nJIRA\n',
    );
  });

  test('json mode includes the full URL + total + unread', () => {
    const out = runMailboxes(env, { json: true });
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(5);
    const inbox = JSON.parse(lines.find((l) => l.includes('user@gmail.com/INBOX'))!);
    expect(inbox).toEqual({
      name: 'INBOX',
      url: 'imap://user@gmail.com/INBOX',
      total: 10,
      unread: 3,
    });
  });

  test('filter restricts URL substring (case-insensitive)', () => {
    const out = runMailboxes(env, { json: false, filter: 'USER@GMAIL' });
    expect(out).toBe('INBOX\nJIRA\n');
  });

  test('filter that matches nothing returns empty string', () => {
    expect(runMailboxes(env, { json: false, filter: 'no-such-host' })).toBe('');
  });
});
