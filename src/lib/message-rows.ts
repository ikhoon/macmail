// message-rows.ts — shared display-row builder for message lists (triage /
// search). One place decides the column set, per-column content, and styling,
// so both commands render identically:
//
//   date · [account] · [mailbox] · sender · subject · id · [snippet]
//
// - account: only when the rows span >1 account. Short account name by
//   default; --full shows the account email. JSON always keeps the name (a
//   stable selector scripts pass back to --account).
// - mailbox: only when any row carries user labels (Gmail-style categories);
//   label-less rows fall back to their base mailbox name (e.g. INBOX). JSON
//   carries a `labels` array instead.
// - sender: compact display name (bounded width) unless --full; JSON keeps the
//   full `Name <email>`.

import type { MessageSummary } from './envelope.ts';
import {
  accountIdFromMailboxUrl,
  shortMailboxName,
  type Account,
} from './mail-data.ts';
import {
  senderDisplayName,
  truncateWidth,
  type Row,
} from './output.ts';
import { blue, bold, cyan, dim, green, magenta, yellow } from './color.ts';
import { linkifyGitHub } from './links.ts';

/** Max display width for the (name-only) sender column in text mode. */
export const SENDER_WIDTH = 28;

export interface MessageRowsOptions {
  json: boolean;
  /** Show the full `Name <email>` sender / account email instead of the
   *  compact forms. */
  full?: boolean;
}

export interface MessageRowsPlan {
  rows: Row[];
  fields: string[];
  styles: Record<string, (s: string) => string>;
}

/** A mailbox URL → a per-account label from a UUID→label map, falling back to
 *  the raw authority (already readable for email-style fixtures). */
function accountLabel(url: string, labelById: Map<string, string>): string {
  const id = accountIdFromMailboxUrl(url);
  if (!id) return '';
  return labelById.get(id.toUpperCase()) || id;
}

/** Build display rows + the field/style plan for a list of messages. */
export function buildMessageRows(
  msgs: MessageSummary[],
  opts: MessageRowsOptions,
  accounts: Account[] = [],
): MessageRowsPlan {
  const nameById = new Map(accounts.map((a) => [a.uuid.toUpperCase(), a.name]));
  const emailById = new Map(
    accounts.map((a) => [a.uuid.toUpperCase(), a.email ?? a.name]),
  );
  const idOf = (m: MessageSummary) =>
    accountIdFromMailboxUrl(m.mailboxUrl)?.toUpperCase() ?? '';

  const multiAccount = new Set(msgs.map(idOf)).size > 1;
  const anyLabels = msgs.some((m) => (m.labels?.length ?? 0) > 0);
  const anySnippet = msgs.some((m) => m.snippet);

  const fields = [
    'date',
    ...(multiAccount ? ['account'] : []),
    ...(anyLabels ? ['mailbox'] : []),
    'sender',
    'subject',
    'id',
    ...(anySnippet ? ['snippet'] : []),
  ];

  const rows = msgs.map((m) => {
    const row: Row = { id: m.id };
    if (multiAccount) {
      // Short name by default; --full swaps in the account email (text only —
      // JSON keeps the name as a stable selector).
      row.account =
        !opts.json && opts.full
          ? accountLabel(m.mailboxUrl, emailById)
          : accountLabel(m.mailboxUrl, nameById);
    }
    if (opts.json) {
      if (m.labels?.length) row.labels = m.labels;
    } else if (anyLabels) {
      row.mailbox = m.labels?.length
        ? m.labels.join(', ')
        : shortMailboxName(m.mailboxUrl);
    }
    row.sender =
      opts.json || opts.full
        ? m.sender
        : truncateWidth(senderDisplayName(m.sender), SENDER_WIDTH);
    row.subject = m.subject;
    row.date = m.dateReceived;
    if (m.snippet) row.snippet = m.snippet;
    if (opts.json && m.text != null) row.text = m.text;
    return row;
  });

  return {
    rows,
    fields,
    styles: {
      id: yellow,
      account: magenta,
      mailbox: blue,
      sender: cyan,
      subject: (s: string) => bold(linkifyGitHub(s)),
      date: green,
      snippet: dim,
    },
  };
}
