// commands/triage.ts — list unread messages in a mailbox.

import type { EnvelopeIndex, MessageSummary } from '../lib/envelope.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import {
  defaultEnvelopeIndexPath,
  listAccounts,
  accountIdFromMailboxUrl,
  type Account,
} from '../lib/mail-data.ts';
import { formatRecords, senderDisplayName, truncateWidth } from '../lib/output.ts';
import { bold, cyan, green, magenta, yellow } from '../lib/color.ts';
import { linkifyGitHub } from '../lib/links.ts';

/** Max display width for the (name-only) sender column in text mode. */
const SENDER_WIDTH = 28;

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

/** A mailbox URL → a per-account label from a UUID→label map, falling back to
 *  the raw authority (already readable for email-style fixtures / unenriched
 *  accounts). Used for the account name (JSON) and the account email (text). */
function accountLabel(url: string, labelById: Map<string, string>): string {
  const id = accountIdFromMailboxUrl(url);
  if (!id) return '';
  return labelById.get(id.toUpperCase()) || id;
}

export function formatTriage(
  msgs: MessageSummary[],
  opts: TriageOptions,
  accounts: Account[] = [],
): string {
  const nameById = new Map(accounts.map((a) => [a.uuid.toUpperCase(), a.name]));
  // Email per account for the text view ("which address did this arrive at");
  // falls back to the name when Accounts4 has no login email (local accounts).
  const emailById = new Map(
    accounts.map((a) => [a.uuid.toUpperCase(), a.email ?? a.name]),
  );
  const nameOf = (m: MessageSummary) => accountLabel(m.mailboxUrl, nameById);
  const emailOf = (m: MessageSummary) => accountLabel(m.mailboxUrl, emailById);
  // Only surface the account column when the result actually spans more than
  // one account — keyed on the account UUID so it's independent of the label.
  const idOf = (m: MessageSummary) =>
    accountIdFromMailboxUrl(m.mailboxUrl)?.toUpperCase() ?? '';
  const multiAccount = new Set(msgs.map(idOf)).size > 1;
  const fields = multiAccount
    ? ['date', 'account', 'sender', 'subject', 'id']
    : ['date', 'sender', 'subject', 'id'];
  return formatRecords(
    msgs.map((m) => {
      const row: Record<string, unknown> = { id: m.id };
      // Account column: the short account name/label by default (emails get
      // long); --full shows the account email instead. JSON keeps the name (a
      // stable selector scripts pass to --account).
      if (multiAccount) row.account = !opts.json && opts.full ? emailOf(m) : nameOf(m);
      // JSON keeps the full sender (scripts need it); text shows a compact
      // name-only form unless --full is passed.
      row.sender =
        opts.json || opts.full
          ? m.sender
          : truncateWidth(senderDisplayName(m.sender), SENDER_WIDTH);
      row.subject = m.subject;
      row.date = m.dateReceived;
      return row;
    }),
    {
      json: opts.json,
      fields,
      align: true,
      styles: {
        id: yellow,
        account: magenta,
        sender: cyan,
        subject: (s) => bold(linkifyGitHub(s)),
        date: green,
      },
    },
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
