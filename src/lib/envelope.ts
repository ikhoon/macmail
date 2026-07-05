// envelope.ts — query Mail.app's Envelope Index SQLite database.
//
// Mail.app maintains an Envelope Index at
//   ~/Library/Mail/V<N>/MailData/Envelope Index
// (plus -wal and -shm sidecars for WAL journaling). It stores normalised
// metadata for every indexed message: sender, subject, mailbox, date, flags.
//
// Two-tier mailbox model: each `mailboxes` row is either a *storage* mailbox
// (source IS NULL — e.g. Gmail's "All Mail") that owns rows in `messages` via
// `messages.mailbox`, or a *view* mailbox (source IS NOT NULL — e.g. INBOX,
// Sent, custom labels) whose contents are joined via the `labels` table
// (labels.message_id × labels.mailbox_id). Read queries must handle both.
//
// Schema names in this wrapper match what's observed on macOS 14/15. If a
// future macOS rearranges columns we'll need to adapt — `inspectSchema()` is
// provided to dump tables/columns for debugging.

import { Database } from 'bun:sqlite';
import { shortMailboxName } from './mail-data.ts';

/** Mailboxes that aren't user categories: the INBOX view and Gmail's system
 *  folders ([Gmail]/*, localized too). Excluded from the labels column. */
function isSystemMailbox(shortName: string): boolean {
  return (
    shortName === 'INBOX' ||
    shortName.startsWith('[Gmail]/') ||
    shortName.startsWith('[Google Mail]/')
  );
}

// Modern Mail.app (V10+) stores message timestamps in messages.date_received
// as Unix seconds — not Cocoa NSDate seconds, despite the historical name.
// Older Mail data may have used NSDate; we now standardise on the current
// shape because it matches what's actually on disk.
export function nsdateSecondsToDate(n: number | null | undefined): Date | null {
  if (n == null) return null;
  return new Date(n * 1000);
}

export interface MailboxRow {
  id: number;
  url: string;
  totalCount: number;
  unreadCount: number;
}

/** A body-search candidate from the Envelope Index. The `.emlx` file for
 *  `id` lives somewhere under the storage mailbox identified by
 *  `storageMailboxUrl`, even when the call resolved a view mailbox. */
export interface BodySearchCandidate {
  id: number;
  storageMailboxUrl: string;
  dateReceived: Date | null;
  subject: string;
  sender: string;
}

export interface MessageSummary {
  id: number;
  sender: string;
  subject: string;
  dateReceived: Date | null;
  read: boolean;
  flags: number;
  mailboxId: number;
  mailboxUrl: string;
  /** Optional body excerpt set by `--in body --snippet` searches. */
  snippet?: string;
  /** Optional decoded text body set by `--body` searches (may be truncated). */
  text?: string;
  /** Optional user labels (Gmail-style), set by attachUserLabels(). Excludes
   *  system mailboxes (INBOX, [Gmail]/*). */
  labels?: string[];
}

/** Structured filters applied alongside subject-LIKE / body grep. All
 *  optional; combined with AND. Substring patterns are case-insensitive
 *  (matched via LOWER()). */
export interface EnvelopeFilters {
  /** Substring against addresses.address OR addresses.comment (display name). */
  sender?: string;
  /** Substring against any recipient's addresses.address. */
  recipient?: string;
  /** Inclusive lower bound on messages.date_received (Unix seconds). */
  sinceUnixSec?: number;
  /** Exclusive upper bound on messages.date_received (Unix seconds). */
  untilUnixSec?: number;
  /** Only messages where the read bit (flags & 1) is unset. */
  unread?: boolean;
  /** Only messages where the flagged column is non-zero. */
  flagged?: boolean;
}

/** Build the extra WHERE-clause fragments + their bound parameters from a
 *  filter bag plus an optional subject query. Returns conditions as raw
 *  strings (no user input) so the caller can join with `AND`; user input
 *  travels exclusively through `params`. */
/** Escape LIKE metacharacters (`\` `%` `_`) so a user substring matches
 *  literally. Pair with `ESCAPE '\'` on the LIKE clause. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildFilterClause(
  filters: EnvelopeFilters | undefined,
  subjectQuery?: string,
): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (subjectQuery != null && subjectQuery !== '') {
    conditions.push("s.subject LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(subjectQuery)}%`);
  }
  if (filters?.sender) {
    const pat = `%${escapeLike(filters.sender.toLowerCase())}%`;
    conditions.push("(LOWER(a.address) LIKE ? ESCAPE '\\' OR LOWER(a.comment) LIKE ? ESCAPE '\\')");
    params.push(pat, pat);
  }
  if (filters?.recipient) {
    const pat = `%${escapeLike(filters.recipient.toLowerCase())}%`;
    conditions.push(
      'EXISTS (SELECT 1 FROM recipients r JOIN addresses ra ON r.address = ra.ROWID ' +
        "WHERE r.message_id = m.ROWID AND LOWER(ra.address) LIKE ? ESCAPE '\\')",
    );
    params.push(pat);
  }
  if (filters?.sinceUnixSec != null) {
    conditions.push('m.date_received >= ?');
    params.push(filters.sinceUnixSec);
  }
  if (filters?.untilUnixSec != null) {
    conditions.push('m.date_received < ?');
    params.push(filters.untilUnixSec);
  }
  if (filters?.unread) {
    conditions.push('(m.flags & 1) = 0');
  }
  if (filters?.flagged) {
    conditions.push('m.flagged != 0');
  }
  return { conditions, params };
}

interface RawMessageJoin {
  id: number;
  subject: string | null;
  senderAddress: string | null;
  senderName: string | null;
  dateRecv: number | null;
  flags: number;
  mailboxId: number;
  mailboxUrl: string;
}

function formatSender(address: string | null, name: string | null): string {
  if (!address) return name ?? '';
  if (!name) return address;
  return `${name} <${address}>`;
}

function rawToSummary(r: RawMessageJoin): MessageSummary {
  return {
    id: r.id,
    sender: formatSender(r.senderAddress, r.senderName),
    subject: r.subject ?? '',
    dateReceived: nsdateSecondsToDate(r.dateRecv),
    read: (r.flags & 1) !== 0,
    flags: r.flags,
    mailboxId: r.mailboxId,
    mailboxUrl: r.mailboxUrl,
  };
}

export class EnvelopeIndex {
  readonly db: Database;
  private readonly owned: boolean;

  constructor(source: Database | string, opts?: { readonly?: boolean }) {
    if (typeof source === 'string') {
      this.db = new Database(source, { readonly: opts?.readonly ?? true });
      this.owned = true;
    } else {
      this.db = source;
      this.owned = false;
    }
  }

  close(): void {
    if (this.owned) this.db.close();
  }

  /** List every table + column for debugging when the schema doesn't match. */
  inspectSchema(): Array<{ table: string; columns: string[] }> {
    const tables = this.db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    ).all();
    return tables.map((t) => ({
      table: t.name,
      columns: this.db
        .query<{ name: string }, []>(`PRAGMA table_info("${t.name}")`)
        .all()
        .map((c) => c.name),
    }));
  }

  listMailboxes(opts?: { urlLike?: string }): MailboxRow[] {
    const where = opts?.urlLike ? `WHERE url LIKE ?` : ``;
    const params: string[] = opts?.urlLike ? [opts.urlLike] : [];
    const rows = this.db
      .query<MailboxRow, string[]>(
        `SELECT ROWID as id, url, total_count as totalCount, unread_count as unreadCount
         FROM mailboxes ${where} ORDER BY url`,
      )
      .all(...params);
    return rows;
  }

  /**
   * Unread, non-deleted messages in matching mailboxes, newest-first.
   * Combines direct (`messages.mailbox`) and label-mapped (`labels`) paths so
   * both Gmail-style view mailboxes and plain IMAP folders work.
   */
  triage(opts: { mailboxUrlLike: string; max: number }): MessageSummary[] {
    const rows = this.db
      .query<RawMessageJoin, [string, string, number]>(
        `SELECT m.ROWID as id, s.subject as subject, a.address as senderAddress,
                a.comment as senderName, m.date_received as dateRecv,
                m.flags as flags, mb.ROWID as mailboxId, mb.url as mailboxUrl
         FROM messages m
         LEFT JOIN subjects  s ON m.subject = s.ROWID
         LEFT JOIN addresses a ON m.sender  = a.ROWID
         JOIN      mailboxes mb ON m.mailbox = mb.ROWID
         WHERE mb.url LIKE ? AND mb.source IS NULL
           AND (m.flags & 1) = 0 AND (m.flags & 2) = 0
         UNION ALL
         SELECT m.ROWID as id, s.subject as subject, a.address as senderAddress,
                a.comment as senderName, m.date_received as dateRecv,
                m.flags as flags, mb.ROWID as mailboxId, mb.url as mailboxUrl
         FROM labels l
         JOIN      messages m  ON l.message_id = m.ROWID
         JOIN      mailboxes mb ON l.mailbox_id = mb.ROWID
         LEFT JOIN subjects  s ON m.subject = s.ROWID
         LEFT JOIN addresses a ON m.sender  = a.ROWID
         WHERE mb.url LIKE ? AND mb.source IS NOT NULL
           AND (m.flags & 1) = 0 AND (m.flags & 2) = 0
         ORDER BY dateRecv DESC
         LIMIT ?`,
      )
      .all(opts.mailboxUrlLike, opts.mailboxUrlLike, opts.max);
    return rows.map(rawToSummary);
  }

  /**
   * IDs of ALL messages matching a subject search — same WHERE as
   * searchSubject but with no LIMIT and no display joins hydrated, so it
   * stays cheap even for tens of thousands of matches. Used to report an
   * exact `total` where searchSubject's over-fetch cap would undercount.
   */
  searchSubjectIds(opts: {
    mailboxUrlLike: string;
    query?: string;
    filters?: EnvelopeFilters;
  }): number[] {
    const { conditions, params: filterParams } = buildFilterClause(
      opts.filters,
      opts.query,
    );
    const extra = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const sql =
      `SELECT DISTINCT id FROM (
         SELECT m.ROWID as id
         FROM messages m
         LEFT JOIN subjects  s ON m.subject = s.ROWID
         LEFT JOIN addresses a ON m.sender  = a.ROWID
         JOIN      mailboxes mb ON m.mailbox = mb.ROWID
         WHERE mb.url LIKE ? AND mb.source IS NULL AND (m.flags & 2) = 0${extra}
         UNION ALL
         SELECT m.ROWID as id
         FROM labels l
         JOIN      messages m  ON l.message_id = m.ROWID
         JOIN      mailboxes mb ON l.mailbox_id = mb.ROWID
         LEFT JOIN subjects  s ON m.subject = s.ROWID
         LEFT JOIN addresses a ON m.sender  = a.ROWID
         WHERE mb.url LIKE ? AND mb.source IS NOT NULL AND (m.flags & 2) = 0${extra}
       )`;
    const params: (string | number)[] = [
      opts.mailboxUrlLike,
      ...filterParams,
      opts.mailboxUrlLike,
      ...filterParams,
    ];
    return this.db
      .query<{ id: number }, (string | number)[]>(sql)
      .all(...params)
      .map((r) => r.id);
  }

  /**
   * Attach each message's user labels (Gmail-style categories) in place, via
   * the `labels` table joined to `mailboxes`. System mailboxes (INBOX,
   * [Gmail]/*) are excluded, so what's left is the categorization the user
   * cares about (e.g. "dev/bomnun"). No-op for an empty list. Cheap: one
   * `WHERE message_id IN (…)` query.
   */
  attachUserLabels(msgs: MessageSummary[]): void {
    if (msgs.length === 0) return;
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const placeholders = msgs.map(() => '?').join(',');
    const rows = this.db
      .query<{ messageId: number; url: string }, number[]>(
        `SELECT l.message_id AS messageId, mb.url AS url
         FROM labels l JOIN mailboxes mb ON l.mailbox_id = mb.ROWID
         WHERE l.message_id IN (${placeholders})`,
      )
      .all(...msgs.map((m) => m.id));
    const acc = new Map<number, string[]>();
    for (const r of rows) {
      const name = shortMailboxName(r.url);
      if (isSystemMailbox(name)) continue;
      const list = acc.get(r.messageId) ?? [];
      if (!list.includes(name)) list.push(name);
      acc.set(r.messageId, list);
    }
    for (const [id, labels] of acc) {
      const m = byId.get(id);
      if (m) m.labels = labels.sort();
    }
  }

  /**
   * Subject and/or filter-driven search across matching mailboxes (storage
   * + label-mapped views), newest-first.
   *
   * `query` is an optional case-insensitive substring against
   * `subjects.subject`. With no query and no filters, returns every
   * message in the matching mailbox(es) (capped at `max`).
   */
  searchSubject(opts: {
    mailboxUrlLike: string;
    query?: string;
    max: number;
    filters?: EnvelopeFilters;
  }): MessageSummary[] {
    const { conditions, params: filterParams } = buildFilterClause(
      opts.filters,
      opts.query,
    );
    const extra = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const sql =
      `SELECT m.ROWID as id, s.subject as subject, a.address as senderAddress,
              a.comment as senderName, m.date_received as dateRecv,
              m.flags as flags, mb.ROWID as mailboxId, mb.url as mailboxUrl
       FROM messages m
       LEFT JOIN subjects  s ON m.subject = s.ROWID
       LEFT JOIN addresses a ON m.sender  = a.ROWID
       JOIN      mailboxes mb ON m.mailbox = mb.ROWID
       WHERE mb.url LIKE ? AND mb.source IS NULL AND (m.flags & 2) = 0${extra}
       UNION ALL
       SELECT m.ROWID as id, s.subject as subject, a.address as senderAddress,
              a.comment as senderName, m.date_received as dateRecv,
              m.flags as flags, mb.ROWID as mailboxId, mb.url as mailboxUrl
       FROM labels l
       JOIN      messages m  ON l.message_id = m.ROWID
       JOIN      mailboxes mb ON l.mailbox_id = mb.ROWID
       LEFT JOIN subjects  s ON m.subject = s.ROWID
       LEFT JOIN addresses a ON m.sender  = a.ROWID
       WHERE mb.url LIKE ? AND mb.source IS NOT NULL AND (m.flags & 2) = 0${extra}
       ORDER BY dateRecv DESC
       LIMIT ?`;
    const params: (string | number)[] = [
      opts.mailboxUrlLike,
      ...filterParams,
      opts.mailboxUrlLike,
      ...filterParams,
      opts.max,
    ];
    const rows = this.db
      .query<RawMessageJoin, (string | number)[]>(sql)
      .all(...params);
    return rows.map(rawToSummary);
  }

  /**
   * Candidate messages for body search: messages.ROWID + the URL of the
   * storage mailbox the .emlx file actually lives under. Resolves view
   * mailboxes via the labels table so a query against an INBOX view returns
   * candidates whose .emlx files are physically in the source storage mbox
   * (e.g. Gmail's "All Mail"). Always excludes deleted messages
   * (`(flags & 2) != 0`). Application-side dedups message IDs that surface
   * from multiple labels.
   */
  listBodySearchCandidates(opts: {
    mailboxUrlLike: string;
    max: number;
    filters?: EnvelopeFilters;
  }): BodySearchCandidate[] {
    const { conditions, params: filterParams } = buildFilterClause(opts.filters);
    const allConditions = ['(m.flags & 2) = 0', ...conditions];
    const where = allConditions.join(' AND ');
    const sql =
      `SELECT m.ROWID as id, mb_storage.url as storageMailboxUrl,
              m.date_received as dateRecv, s.subject as subject,
              a.address as senderAddress, a.comment as senderName
       FROM messages m
       JOIN      mailboxes mb_match   ON m.mailbox = mb_match.ROWID
       JOIN      mailboxes mb_storage ON m.mailbox = mb_storage.ROWID
       LEFT JOIN subjects  s ON m.subject = s.ROWID
       LEFT JOIN addresses a ON m.sender  = a.ROWID
       WHERE mb_match.url LIKE ? AND mb_match.source IS NULL AND ${where}
       UNION ALL
       SELECT m.ROWID as id, mb_storage.url as storageMailboxUrl,
              m.date_received as dateRecv, s.subject as subject,
              a.address as senderAddress, a.comment as senderName
       FROM labels l
       JOIN      messages  m          ON l.message_id = m.ROWID
       JOIN      mailboxes mb_match   ON l.mailbox_id = mb_match.ROWID
       JOIN      mailboxes mb_storage ON m.mailbox    = mb_storage.ROWID
       LEFT JOIN subjects  s ON m.subject = s.ROWID
       LEFT JOIN addresses a ON m.sender  = a.ROWID
       WHERE mb_match.url LIKE ? AND mb_match.source IS NOT NULL AND ${where}
       ORDER BY dateRecv DESC
       LIMIT ?`;
    // Over-fetch so dedup has room to trim down to `max` distinct ids.
    const params: (string | number)[] = [
      opts.mailboxUrlLike,
      ...filterParams,
      opts.mailboxUrlLike,
      ...filterParams,
      Math.max(opts.max * 2, opts.max + 8),
    ];
    const rows = this.db
      .query<
        {
          id: number;
          storageMailboxUrl: string;
          dateRecv: number | null;
          subject: string | null;
          senderAddress: string | null;
          senderName: string | null;
        },
        (string | number)[]
      >(sql)
      .all(...params);

    const seen = new Map<number, BodySearchCandidate>();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.set(r.id, {
        id: r.id,
        storageMailboxUrl: r.storageMailboxUrl,
        dateReceived: nsdateSecondsToDate(r.dateRecv),
        subject: r.subject ?? '',
        sender: formatSender(r.senderAddress, r.senderName),
      });
      if (seen.size >= opts.max) break;
    }
    return Array.from(seen.values());
  }

  /** Find a message by its Mail.app integer ID. Returns null when absent. */
  findMessage(id: number): MessageSummary | null {
    const row = this.db
      .query<RawMessageJoin, [number]>(
        `SELECT m.ROWID as id, s.subject as subject, a.address as senderAddress,
                a.comment as senderName, m.date_received as dateRecv,
                m.flags as flags, mb.ROWID as mailboxId, mb.url as mailboxUrl
         FROM messages m
         LEFT JOIN subjects  s ON m.subject = s.ROWID
         LEFT JOIN addresses a ON m.sender  = a.ROWID
         JOIN      mailboxes mb ON m.mailbox = mb.ROWID
         WHERE m.ROWID = ?
         LIMIT 1`,
      )
      .get(id);
    return row ? rawToSummary(row) : null;
  }
}
