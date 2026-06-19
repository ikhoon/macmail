import { describe, expect, test, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { EnvelopeIndex, nsdateSecondsToDate } from '../src/lib/envelope.ts';

// Build an in-memory fixture mirroring Mail.app's Envelope Index minimum
// schema, including the two-tier mailbox model (storage + view via labels).
function buildFixtureDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mailboxes (
      ROWID INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      total_count INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      source INTEGER
    );
    CREATE TABLE addresses (
      ROWID INTEGER PRIMARY KEY,
      address TEXT,
      comment TEXT
    );
    CREATE TABLE subjects (
      ROWID INTEGER PRIMARY KEY,
      subject TEXT
    );
    CREATE TABLE messages (
      ROWID INTEGER PRIMARY KEY,
      sender INTEGER,
      subject INTEGER,
      mailbox INTEGER,
      date_received INTEGER,
      flags INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0
    );
    CREATE TABLE labels (
      message_id INTEGER,
      mailbox_id INTEGER,
      PRIMARY KEY (message_id, mailbox_id)
    );
    CREATE TABLE recipients (
      ROWID INTEGER PRIMARY KEY,
      message_id INTEGER,
      address INTEGER,
      type INTEGER DEFAULT 0
    );
  `);

  db.exec(`
    -- mailboxes 1–3: classic storage mailboxes (source IS NULL).
    -- mailbox 4: storage "[Gmail]/All Mail"; mailbox 5: view "INBOX" backed
    -- by labels referencing mailbox 4 (the Gmail-style case).
    INSERT INTO mailboxes (ROWID, url, total_count, unread_count, source) VALUES
      (1, 'imap://user@gmail.com/INBOX',           10, 3, NULL),
      (2, 'imap://user@gmail.com/JIRA',             5, 1, NULL),
      (3, 'imap://other@icloud.com/INBOX',          7, 0, NULL),
      (4, 'imap://gview@gmail.com/[Gmail]/All Mail', 50, 0, NULL),
      (5, 'imap://gview@gmail.com/INBOX',            2, 1,    4);

    INSERT INTO addresses (ROWID, address, comment) VALUES
      (1, 'alice@example.com', 'Alice'),
      (2, 'bob@example.com',   NULL),
      (3, 'jira@example.com', 'Jira Bot'),
      (4, 'gmail-user@example.com', 'Gmail User');

    INSERT INTO subjects (ROWID, subject) VALUES
      (1, 'Welcome'),
      (2, 'Meeting at noon'),
      (3, '초대장: xDS server design'),
      (4, '[Jira] FOO-123 updated'),
      (5, 'Gmail labelled note'),
      (6, 'Deleted draft');

    -- date_received is Unix seconds (V10+ Mail behaviour). Values are
    -- arbitrary monotonically increasing seconds; the exact wall time is
    -- not asserted by tests, only ordering and presence.
    INSERT INTO messages (ROWID, sender, subject, mailbox, date_received, flags, flagged) VALUES
      (100, 1, 1, 1, 802605600, 1, 0),  -- read
      (101, 2, 2, 1, 802605700, 0, 0),  -- unread
      (102, 1, 3, 1, 802605800, 0, 1),  -- unread, Korean subject, flagged
      (200, 3, 4, 2, 802605900, 0, 0),  -- unread, JIRA mailbox
      (300, 1, 1, 3, 802606000, 0, 0),  -- unread, other account
      (400, 4, 5, 4, 802606100, 0, 0),  -- unread, in storage mailbox 4
      (401, 4, 6, 4, 802606200, 2, 0);  -- DELETED (flags bit 1) in storage mailbox 4

    -- View mailbox 5 reflects messages 400 + 401 via labels.
    INSERT INTO labels (message_id, mailbox_id) VALUES
      (400, 5),
      (401, 5);

    -- recipients: message 100 → Alice; 101 → Alice + Bob; 102 → Bob.
    INSERT INTO recipients (ROWID, message_id, address, type) VALUES
      (1, 100, 1, 0),
      (2, 101, 1, 0),
      (3, 101, 2, 0),
      (4, 102, 2, 0);
  `);
  return db;
}

describe('nsdateSecondsToDate', () => {
  test('treats the input as Unix seconds (V10+ Mail behaviour)', () => {
    // 1779846684 ≈ 2026-05-27 — matches what live Envelope Index rows carry.
    expect(nsdateSecondsToDate(1779846684)?.toISOString()).toBe('2026-05-27T01:51:24.000Z');
  });
  test('null in → null out', () => {
    expect(nsdateSecondsToDate(null)).toBeNull();
    expect(nsdateSecondsToDate(undefined)).toBeNull();
  });
});

describe('EnvelopeIndex', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildFixtureDb());
  });

  test('listMailboxes returns every mailbox (storage + view)', () => {
    const all = env.listMailboxes();
    expect(all).toHaveLength(5);
    expect(all.map((m) => m.url)).toContain('imap://user@gmail.com/INBOX');
    expect(all.map((m) => m.url)).toContain('imap://gview@gmail.com/INBOX');
  });

  test('listMailboxes filters by url pattern', () => {
    const gmail = env.listMailboxes({ urlLike: '%user@gmail.com%' });
    expect(gmail).toHaveLength(2);
    expect(gmail.map((m) => m.url).sort()).toEqual([
      'imap://user@gmail.com/INBOX',
      'imap://user@gmail.com/JIRA',
    ]);
  });

  test('triage returns only unread, newest first, respects max', () => {
    const t = env.triage({ mailboxUrlLike: '%user@gmail.com/INBOX', max: 10 });
    expect(t.map((m) => m.id)).toEqual([102, 101]);
    expect(t[0].read).toBe(false);
    expect(t[0].subject).toBe('초대장: xDS server design');
  });

  test('triage formats sender as "Name <address>" when both present', () => {
    const t = env.triage({ mailboxUrlLike: '%user@gmail.com/INBOX', max: 10 });
    // 101 has bob@example.com with NULL comment → just the address.
    const m101 = t.find((m) => m.id === 101)!;
    expect(m101.sender).toBe('bob@example.com');
    // 102 has alice@example.com with comment "Alice" → "Alice <...>"
    const m102 = t.find((m) => m.id === 102)!;
    expect(m102.sender).toBe('Alice <alice@example.com>');
  });

  test('triage caps results at max', () => {
    const t = env.triage({ mailboxUrlLike: '%user@gmail.com/INBOX', max: 1 });
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe(102);
  });

  test('searchSubject finds Korean substring', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      query: '초대장',
      max: 5,
    });
    expect(r).toHaveLength(1);
    expect(r[0].subject).toBe('초대장: xDS server design');
  });

  test('searchSubject finds english substring', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      query: 'Meeting',
      max: 5,
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(101);
  });

  test('triage walks labels for view mailboxes (source IS NOT NULL)', () => {
    // Mailbox 5 is a view of storage mailbox 4. Message 400 is unread and
    // label-linked; 401 is deleted and must be filtered out.
    const t = env.triage({ mailboxUrlLike: '%gview@gmail.com/INBOX', max: 10 });
    expect(t.map((m) => m.id)).toEqual([400]);
    expect(t[0].subject).toBe('Gmail labelled note');
    expect(t[0].mailboxUrl).toBe('imap://gview@gmail.com/INBOX');
  });

  test('searchSubject walks labels for view mailboxes', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%gview@gmail.com/INBOX',
      query: 'labelled',
      max: 5,
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(400);
  });

  test('triage excludes deleted messages (flags bit 1)', () => {
    // Mailbox 5 contains label entries for 400 (unread) + 401 (deleted).
    const t = env.triage({ mailboxUrlLike: '%gview@gmail.com/INBOX', max: 10 });
    expect(t.find((m) => m.id === 401)).toBeUndefined();
  });

  test('findMessage returns hit by ROWID', () => {
    const m = env.findMessage(102);
    expect(m).not.toBeNull();
    expect(m!.subject).toBe('초대장: xDS server design');
    expect(m!.mailboxUrl).toBe('imap://user@gmail.com/INBOX');
  });

  test('findMessage returns null when not found', () => {
    expect(env.findMessage(99999)).toBeNull();
  });

  test('inspectSchema lists tables and columns', () => {
    const sch = env.inspectSchema();
    const names = sch.map((t) => t.table).sort();
    expect(names).toEqual(
      ['addresses', 'labels', 'mailboxes', 'messages', 'recipients', 'subjects'],
    );
    const msgs = sch.find((t) => t.table === 'messages')!;
    expect(msgs.columns).toContain('flags');
    expect(msgs.columns).toContain('flagged');
    expect(msgs.columns).toContain('date_received');
  });
});

describe('listBodySearchCandidates', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildFixtureDb());
  });

  test('returns messages from a storage mailbox with the storage URL attached', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
    });
    expect(r.map((c) => c.id).sort()).toEqual([100, 101, 102]);
    for (const c of r) {
      expect(c.storageMailboxUrl).toBe('imap://user@gmail.com/INBOX');
    }
  });

  test('walks labels for view mailboxes and returns the storage URL of each message', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%gview@gmail.com/INBOX',
      max: 10,
    });
    // Message 400 is label-linked from view mailbox 5, lives in storage 4.
    // 401 is deleted (flags & 2) and must be excluded.
    expect(r.map((c) => c.id)).toEqual([400]);
    expect(r[0].storageMailboxUrl).toBe('imap://gview@gmail.com/[Gmail]/All Mail');
  });

  test('excludes deleted messages (flags & 2)', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%gview@gmail.com/INBOX',
      max: 10,
    });
    expect(r.find((c) => c.id === 401)).toBeUndefined();
  });

  test('respects max cap', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 2,
    });
    expect(r).toHaveLength(2);
  });

  test('applies sender / sinceUnixSec / unread filters from the bag', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { sender: 'alice', sinceUnixSec: 802605750, unread: true },
    });
    // Among Alice's messages (100, 102), 100 is read and 102 is post-cutoff.
    expect(r.map((c) => c.id)).toEqual([102]);
  });

  test('returns sender formatted as "Name <addr>"', () => {
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { sender: 'alice' },
    });
    expect(r[0].sender).toBe('Alice <alice@example.com>');
  });

  test('dedupes a message that is label-linked from multiple view mailboxes', () => {
    // Inline fixture extension — add a second view of storage mailbox 4
    // and double-label message 400. We rely on the schema staying compatible.
    const db = buildFixtureDb();
    db.exec(`
      INSERT INTO mailboxes (ROWID, url, total_count, unread_count, source) VALUES
        (6, 'imap://gview@gmail.com/Promotions', 1, 0, 4);
      INSERT INTO labels (message_id, mailbox_id) VALUES (400, 6);
    `);
    const env2 = new EnvelopeIndex(db);
    const r = env2.listBodySearchCandidates({
      mailboxUrlLike: '%gview@gmail.com%',
      max: 10,
    });
    expect(r.filter((c) => c.id === 400)).toHaveLength(1);
  });

  test('matches both storage and view rows in one call (no double-counting)', () => {
    // %gmail.com% matches mailbox 1 (storage), 2 (storage), 4 (storage),
    // 5 (view of 4). Message 400's storage row already covers it; the view
    // row must not duplicate it.
    const r = env.listBodySearchCandidates({
      mailboxUrlLike: '%gmail.com%',
      max: 20,
    });
    const counts = new Map<number, number>();
    for (const c of r) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBe(1);
  });
});

describe('searchSubject filter bag', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildFixtureDb());
  });

  test('query is optional — filter-only search returns all matching rows', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      // No query, no filters: every message in the mailbox.
    });
    // Mailbox 1 holds messages 100, 101, 102 — all surface.
    expect(r.map((m) => m.id).sort()).toEqual([100, 101, 102]);
  });

  test('sender filter matches addresses.address (case-insensitive substring)', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { sender: 'BOB' },
    });
    // address 2 = bob@example.com, sender of message 101 only.
    expect(r.map((m) => m.id)).toEqual([101]);
  });

  test('sender filter also matches addresses.comment (display name)', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { sender: 'alice' },
    });
    // address 1 = Alice <alice@example.com>, sender of 100 (read) + 102.
    expect(r.map((m) => m.id).sort()).toEqual([100, 102]);
  });

  test('recipient filter joins through recipients/addresses', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { recipient: 'bob@example.com' },
    });
    // recipients rows for 101 + 102 include Bob.
    expect(r.map((m) => m.id).sort()).toEqual([101, 102]);
  });

  test('sinceUnixSec excludes earlier messages', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { sinceUnixSec: 802605750 },
    });
    // 100 (600), 101 (700) excluded; only 102 (800).
    expect(r.map((m) => m.id)).toEqual([102]);
  });

  test('untilUnixSec is exclusive upper bound', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { untilUnixSec: 802605700 },
    });
    // 100 (600) only; 101 (700) excluded by `< 700`.
    expect(r.map((m) => m.id)).toEqual([100]);
  });

  test('unread filter excludes read messages', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { unread: true },
    });
    // 100 is read, 101 + 102 unread.
    expect(r.map((m) => m.id).sort()).toEqual([101, 102]);
  });

  test('flagged filter only returns messages with the flagged bit set', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      max: 10,
      filters: { flagged: true },
    });
    expect(r.map((m) => m.id)).toEqual([102]);
  });

  test('combines query with filters', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%user@gmail.com/INBOX',
      query: 'Meeting',
      max: 10,
      filters: { sender: 'bob' },
    });
    // subject 2 = "Meeting at noon", message 101, sender Bob → matches.
    expect(r.map((m) => m.id)).toEqual([101]);
  });

  test('filter bag also applies through the view-mailbox labels arm', () => {
    const r = env.searchSubject({
      mailboxUrlLike: '%gview@gmail.com/INBOX',
      max: 10,
      filters: { sinceUnixSec: 802606150 }, // excludes 400 (100), includes 401 (200) — but 401 is "deleted"
    });
    // Note: searchSubject does not exclude deleted (no test fixture relies on it).
    // 400 (100) excluded, 401 (200) survives.
    expect(r.map((m) => m.id)).toEqual([401]);
  });
});
