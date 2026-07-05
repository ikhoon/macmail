// commands/mailboxes.ts — list Envelope Index mailboxes, optionally filtered.

import type { EnvelopeIndex, MailboxRow } from '../lib/envelope.ts';
import { defaultEnvelopeIndexPath, shortMailboxName } from '../lib/mail-data.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import { formatRecords } from '../lib/output.ts';
import { cyan } from '../lib/color.ts';

// Re-exported for callers (and tests) that import it from here.
export { shortMailboxName };

export interface MailboxesOptions {
  json: boolean;
  /** Substring filter against the mailbox URL (case-insensitive). */
  filter?: string;
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
      align: true,
      styles: { name: cyan },
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
