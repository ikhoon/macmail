// commands/triage.ts — list unread messages in a mailbox.

import type { EnvelopeIndex, MessageSummary } from '../lib/envelope.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import {
  defaultEnvelopeIndexPath,
  listAccounts,
  accountIdFromMailboxUrl,
  type Account,
} from '../lib/mail-data.ts';
import { formatRecords } from '../lib/output.ts';

export interface TriageOptions {
  json: boolean;
  /** Substring matched against the mailbox URL (typically a resolved UUID).
   *  An empty string matches the same `mailbox` under every account. */
  account: string;
  /** Mailbox name, matched as the trailing URL path component. */
  mailbox: string;
  max: number;
}

/** Build the `mb.url LIKE` pattern used by EnvelopeIndex.triage. An empty
 *  `account` yields `%/<mailbox>`, which matches that mailbox under every
 *  account. */
export function buildMailboxUrlPattern(account: string, mailbox: string): string {
  return `%${account}%/${mailbox}`;
}

/** A mailbox URL → human account label: the account description from
 *  Accounts4 when the URL's UUID is known, else the raw authority (already
 *  readable for email-style fixtures / unenriched accounts). */
function accountLabel(url: string, nameById: Map<string, string>): string {
  const id = accountIdFromMailboxUrl(url);
  if (!id) return '';
  return nameById.get(id.toUpperCase()) ?? id;
}

export function formatTriage(
  msgs: MessageSummary[],
  opts: TriageOptions,
  accounts: Account[] = [],
): string {
  const nameById = new Map(accounts.map((a) => [a.uuid.toUpperCase(), a.name]));
  const labelOf = (m: MessageSummary) => accountLabel(m.mailboxUrl, nameById);
  // Only surface the account column when the result actually spans more than
  // one account — keeps the common single-account view uncluttered.
  const multiAccount = new Set(msgs.map(labelOf)).size > 1;
  const fields = multiAccount
    ? ['id', 'account', 'sender', 'subject', 'date']
    : ['id', 'sender', 'subject', 'date'];
  return formatRecords(
    msgs.map((m) => {
      const row: Record<string, unknown> = { id: m.id };
      if (multiAccount) row.account = labelOf(m);
      row.sender = m.sender;
      row.subject = m.subject;
      row.date = m.dateReceived;
      return row;
    }),
    { json: opts.json, fields },
  );
}

export function runTriage(
  env: EnvelopeIndex,
  opts: TriageOptions,
  accounts: Account[] = [],
): string {
  const msgs = env.triage({
    mailboxUrlLike: buildMailboxUrlPattern(opts.account, opts.mailbox),
    max: opts.max,
  });
  return formatTriage(msgs, opts, accounts);
}

export function runTriageWithDefaultIndex(opts: TriageOptions): string {
  const env = new EI(defaultEnvelopeIndexPath());
  try {
    let accounts: Account[] = [];
    try {
      accounts = listAccounts();
    } catch {
      // Account labels are a nicety; fall back to URL-derived ids when the
      // account list can't be read.
    }
    return runTriage(env, opts, accounts);
  } finally {
    env.close();
  }
}
