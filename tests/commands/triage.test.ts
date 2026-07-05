import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EnvelopeIndex, type MessageSummary } from '../../src/lib/envelope.ts';
import {
  buildMailboxUrlPattern,
  formatTriage,
  runTriage,
} from '../../src/commands/triage.ts';
import type { Account } from '../../src/lib/mail-data.ts';
import { buildEnvelopeFixture } from '../helpers/envelope-fixture.ts';

describe('buildMailboxUrlPattern', () => {
  test('produces a LIKE pattern matching the mailbox URL convention', () => {
    expect(buildMailboxUrlPattern('gmail', 'INBOX')).toBe('%gmail%/INBOX');
    expect(buildMailboxUrlPattern('user@example.com', 'JIRA')).toBe('%user@example.com%/JIRA');
  });

  test('empty account spans every account (%/<mailbox>)', () => {
    expect(buildMailboxUrlPattern('', 'INBOX')).toBe('%%/INBOX');
  });
});

describe('triage command', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildEnvelopeFixture());
  });
  afterAll(() => env.close());

  test('returns only unread messages, newest first', () => {
    const out = runTriage(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      max: 10,
    });
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    // Columns are date · sender · subject · id (id last).
    const [first, second] = lines.map((l) => l.split(/ {2,}/));
    expect(first.at(-1)).toBe('102'); // newest unread — id is the last column
    expect(first[2]).toBe('초대장: xDS server design');
    expect(second.at(-1)).toBe('101');
  });

  test('respects max', () => {
    const out = runTriage(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      max: 1,
    });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(out).toContain('102');
  });

  test('different mailbox returns its unread', () => {
    const out = runTriage(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'JIRA',
      max: 5,
    });
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[Jira] FOO-123');
  });

  test('json mode emits NDJSON with id, sender, subject, date', () => {
    const out = runTriage(env, {
      json: true,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      max: 1,
    });
    const obj = JSON.parse(out.trim());
    expect(obj.id).toBe(102);
    expect(obj.subject).toBe('초대장: xDS server design');
    expect(typeof obj.date).toBe('string');
    expect(obj.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('no matches returns empty string', () => {
    expect(
      runTriage(env, { json: false, account: 'nobody', mailbox: 'NONE', max: 10 }),
    ).toBe('');
  });

  test('empty account spans all accounts and adds an account column', () => {
    // Empty selector → %%/INBOX matches the INBOX of user@gmail.com (storage),
    // other@icloud.com (storage) and gview@gmail.com (label-mapped view).
    const out = runTriage(env, { json: false, account: '', mailbox: 'INBOX', max: 10 });
    const rows = out.trim().split('\n').map((l) => l.split(/ {2,}/));
    // Columns are date · account · sender · subject · id (id last).
    // 400 (gview), 300 (icloud), 102 + 101 (user@gmail), newest-first.
    expect(rows.map((r) => r.at(-1))).toEqual(['400', '300', '102', '101']);
    expect(rows.every((r) => r.length === 5)).toBe(true);
    // Account column (after date) carries the URL authority when no Account list.
    expect(rows[0][1]).toBe('gview@gmail.com');
    expect(rows[1][1]).toBe('other@icloud.com');
    expect(rows[2][1]).toBe('user@gmail.com');
  });

  test('single-account result keeps the original 4-column layout', () => {
    const out = runTriage(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      max: 10,
    });
    const rows = out.trim().split('\n').map((l) => l.split(/ {2,}/));
    expect(rows.every((r) => r.length === 4)).toBe(true);
  });
});

describe('formatTriage account column', () => {
  const msg = (id: number, mailboxUrl: string): MessageSummary => ({
    id,
    sender: `s${id}@x.com`,
    subject: `subject ${id}`,
    dateReceived: new Date(id * 1000),
    read: false,
    flags: 0,
    mailboxId: id,
    mailboxUrl,
  });
  const accounts: Account[] = [
    { uuid: 'AAAAAAAA-0000-0000-0000-000000000001', name: 'Work', email: 'w@x.com', type: 'Gmail' },
    { uuid: 'BBBBBBBB-0000-0000-0000-000000000002', name: 'Personal', email: 'p@x.com', type: 'iCloud' },
  ];
  const opts = { json: false, account: '', mailbox: 'INBOX', max: 10 };

  test('text mode shows the account email when spanning accounts', () => {
    const out = formatTriage(
      [
        msg(2, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX'),
        msg(1, 'imap://BBBBBBBB-0000-0000-0000-000000000002/INBOX'),
      ],
      opts,
      accounts,
    );
    const rows = out.trim().split('\n').map((l) => l.split(/ {2,}/));
    expect(rows[0][1]).toBe('w@x.com');
    expect(rows[1][1]).toBe('p@x.com');
  });

  test('falls back to the account name when it has no login email', () => {
    const noEmail: Account[] = [
      { uuid: 'AAAAAAAA-0000-0000-0000-000000000001', name: 'On My Mac', email: null, type: 'Local' },
      { uuid: 'BBBBBBBB-0000-0000-0000-000000000002', name: 'Personal', email: 'p@x.com', type: 'iCloud' },
    ];
    const out = formatTriage(
      [
        msg(2, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX'),
        msg(1, 'imap://BBBBBBBB-0000-0000-0000-000000000002/INBOX'),
      ],
      opts,
      noEmail,
    );
    const rows = out.trim().split('\n').map((l) => l.split(/ {2,}/));
    expect(rows[0][1]).toBe('On My Mac');
    expect(rows[1][1]).toBe('p@x.com');
  });

  test('omits the column when every row is the same account', () => {
    const out = formatTriage(
      [
        msg(2, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX'),
        msg(1, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX'),
      ],
      opts,
      accounts,
    );
    const rows = out.trim().split('\n').map((l) => l.split(/ {2,}/));
    expect(rows.every((r) => r.length === 4)).toBe(true);
  });

  test('json rows carry the account field only when spanning accounts', () => {
    const spanning = formatTriage(
      [
        msg(2, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX'),
        msg(1, 'imap://BBBBBBBB-0000-0000-0000-000000000002/INBOX'),
      ],
      { ...opts, json: true },
      accounts,
    );
    const first = JSON.parse(spanning.trim().split('\n')[0]);
    expect(first.account).toBe('Work');

    const single = formatTriage(
      [msg(2, 'imap://AAAAAAAA-0000-0000-0000-000000000001/INBOX')],
      { ...opts, json: true },
      accounts,
    );
    expect(JSON.parse(single.trim()).account).toBeUndefined();
  });
});
