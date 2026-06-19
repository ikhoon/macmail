// commands/mailboxes.ts — list Envelope Index mailboxes, optionally filtered.

import type { EnvelopeIndex, MailboxRow } from '../lib/envelope.ts';
import { defaultEnvelopeIndexPath } from '../lib/mail-data.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import { formatRecords } from '../lib/output.ts';

export interface MailboxesOptions {
  json: boolean;
  /** Substring filter against the mailbox URL (case-insensitive). */
  filter?: string;
}

/** Strip `imap://user@host/` prefix from a Mail.app mailbox URL. */
export function shortMailboxName(url: string): string {
  const m = url.match(/^[^:]+:\/\/[^/]+\/(.*)$/);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function formatMailboxes(rows: MailboxRow[], opts: MailboxesOptions): string {
  let list = rows;
  if (opts.filter) {
    const f = opts.filter.toLowerCase();
    list = rows.filter((r) => r.url.toLowerCase().includes(f));
  }
  return formatRecords(
    list.map((r) => ({
      name: shortMailboxName(r.url),
      url: r.url,
      total: r.totalCount,
      unread: r.unreadCount,
    })),
    {
      json: opts.json,
      // Text mode shows just the short mailbox name (path tail of the URL);
      // JSON includes the full URL plus totals.
      fields: opts.json ? undefined : ['name'],
    },
  );
}

export function runMailboxes(env: EnvelopeIndex, opts: MailboxesOptions): string {
  return formatMailboxes(env.listMailboxes(), opts);
}

export function runMailboxesWithDefaultIndex(opts: MailboxesOptions): string {
  const env = new EI(defaultEnvelopeIndexPath());
  try {
    return runMailboxes(env, opts);
  } finally {
    env.close();
  }
}
