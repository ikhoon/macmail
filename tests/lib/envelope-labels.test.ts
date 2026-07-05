import { describe, expect, test } from 'bun:test';
import { EnvelopeIndex, type MessageSummary } from '../../src/lib/envelope.ts';
import { buildEnvelopeFixture } from '../helpers/envelope-fixture.ts';

/** Fixture DB augmented with a WORKFLOW user label and a system Gmail label,
 *  both attached to message 400 (which already carries the INBOX view label). */
function withLabels(): EnvelopeIndex {
  const db = buildEnvelopeFixture();
  db.exec(`
    INSERT INTO mailboxes (ROWID, url, total_count, unread_count, source) VALUES
      (6, 'imap://gview@gmail.com/WORKFLOW',        3, 1, 4),
      (7, 'imap://gview@gmail.com/[Gmail]/Important', 9, 0, 4);
    INSERT INTO labels (message_id, mailbox_id) VALUES
      (400, 6),
      (400, 7);
  `);
  return new EnvelopeIndex(db);
}

describe('attachUserLabels', () => {
  test('attaches user labels, excluding INBOX and [Gmail]/* system mailboxes', () => {
    const env = withLabels();
    try {
      const msgs: MessageSummary[] = [
        { id: 400, sender: '', subject: '', dateReceived: null, read: false, flags: 0, mailboxId: 5, mailboxUrl: 'imap://gview@gmail.com/INBOX' },
      ];
      env.attachUserLabels(msgs);
      expect(msgs[0].labels).toEqual(['WORKFLOW']); // INBOX + [Gmail]/Important filtered out
    } finally {
      env.close();
    }
  });

  test('leaves messages with no user labels untouched', () => {
    const env = new EnvelopeIndex(buildEnvelopeFixture());
    try {
      const msgs: MessageSummary[] = [
        { id: 101, sender: '', subject: '', dateReceived: null, read: false, flags: 0, mailboxId: 1, mailboxUrl: 'imap://user@gmail.com/INBOX' },
      ];
      env.attachUserLabels(msgs);
      expect(msgs[0].labels).toBeUndefined();
    } finally {
      env.close();
    }
  });

  test('no-op on an empty list', () => {
    const env = new EnvelopeIndex(buildEnvelopeFixture());
    try {
      expect(() => env.attachUserLabels([])).not.toThrow();
    } finally {
      env.close();
    }
  });
});
