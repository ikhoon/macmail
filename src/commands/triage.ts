// commands/triage.ts — list unread messages in a mailbox.

import type { EnvelopeIndex, MessageSummary } from '../lib/envelope.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import {
  defaultEnvelopeIndexPath,
  listAccounts,
  type Account,
} from '../lib/mail-data.ts';
import { formatRecords } from '../lib/output.ts';
import { buildMessageRows } from '../lib/message-rows.ts';

export interface TriageOptions {
  json: boolean;
  /** Substring matched against the mailbox URL (typically a resolved UUID).
   *  An empty string matches the same `mailbox` under every account. */
  account: string;
  /** Mailbox name, matched as the trailing URL path component. */
  mailbox: string;
  max: number;
  /** Show the full `Name <email>` sender instead of the compact name-only form. */
  full?: boolean;
}

/** Build the `mb.url LIKE` pattern used by EnvelopeIndex.triage. An empty
 *  `account` yields `%/<mailbox>`, which matches that mailbox under every
 *  account. */
export function buildMailboxUrlPattern(account: string, mailbox: string): string {
  return `%${account}%/${mailbox}`;
}

export function formatTriage(
  msgs: MessageSummary[],
  opts: TriageOptions,
  accounts: Account[] = [],
): string {
  // Column set, contents, and styling are shared with `search` — see
  // lib/message-rows.ts for the layout rules.
  const plan = buildMessageRows(msgs, { json: opts.json, full: opts.full }, accounts);
  return formatRecords(plan.rows, {
    json: opts.json,
    fields: plan.fields,
    align: true,
    styles: plan.styles,
  });
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
  env.attachUserLabels(msgs);
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
