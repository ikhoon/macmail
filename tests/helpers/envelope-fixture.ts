// Shared in-memory Envelope Index fixture for command tests.
//
// Mirrors the two mailbox tiers of the real Mail.app schema:
//   - storage mailboxes (source IS NULL) own messages directly via
//     messages.mailbox
//   - view mailboxes (source IS NOT NULL) borrow messages via the labels
//     join table
import { Database } from 'bun:sqlite';

export function buildEnvelopeFixture(): Database {
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
    -- mailbox 4: storage "[Gmail]/All Mail" for the Gmail-style account.
    -- mailbox 5: view mailbox "INBOX" backed by labels referencing mailbox 4.
    INSERT INTO mailboxes (ROWID, url, total_count, unread_count, source) VALUES
      (1, 'imap://user@gmail.com/INBOX',       10, 3, NULL),
      (2, 'imap://user@gmail.com/JIRA',         5, 1, NULL),
      (3, 'imap://other@icloud.com/INBOX',      7, 0, NULL),
      (4, 'imap://gview@gmail.com/[Gmail]/All Mail', 50, 0, NULL),
      (5, 'imap://gview@gmail.com/INBOX',        2, 1,    4);

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

    INSERT INTO messages (ROWID, sender, subject, mailbox, date_received, flags) VALUES
      (100, 1, 1, 1, 802605600, 1),  -- read
      (101, 2, 2, 1, 802605700, 0),  -- unread
      (102, 1, 3, 1, 802605800, 0),  -- unread, Korean subject
      (200, 3, 4, 2, 802605900, 0),  -- unread, JIRA mailbox
      (300, 1, 1, 3, 802606000, 0),  -- unread, other account
      (400, 4, 5, 4, 802606100, 0),  -- unread, in storage mailbox 4
      (401, 4, 6, 4, 802606200, 2);  -- DELETED (flags bit 1), in storage mailbox 4

    -- View mailbox 5 inherits messages 400 + 401 from storage 4 via labels.
    INSERT INTO labels (message_id, mailbox_id) VALUES
      (400, 5),
      (401, 5);
  `);
  return db;
}
