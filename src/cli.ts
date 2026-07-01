#!/usr/bin/env bun
// macmail — TypeScript entry point.

import { Command } from 'commander';
import pkg from '../package.json';
import { canReadMailDir, promptFullDiskAccess, fdaGrantTarget } from './lib/osascript.ts';
import {
  resolveAccountSelector,
  resolveAccountSelectorVerbose,
  type AccountResolution,
} from './lib/mail-data.ts';
import { runAccounts } from './commands/accounts.ts';
import { runMailboxesWithDefaultIndex } from './commands/mailboxes.ts';
import { runTriageWithDefaultIndex } from './commands/triage.ts';
import {
  runSearchWithDefaultIndex,
  formatSearchOutput,
  parseSearchDate,
  relativeDaysToUnixSec,
  type SearchScope,
} from './commands/search.ts';
import type { EnvelopeFilters } from './lib/envelope.ts';
import { runRead } from './commands/read.ts';
import { runMark, type MarkState } from './commands/mark.ts';
import { runSend } from './commands/send.ts';
import { runReply } from './commands/reply.ts';
import { runCompletions } from './commands/completions.ts';
import { reexecWithDisclaim } from './lib/disclaim.ts';
import {
  MARK_APPLESCRIPT,
  SEND_APPLESCRIPT,
  REPLY_APPLESCRIPT,
} from './lib/applescripts.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Before anything else: become our own TCC "responsible process" so Full Disk
// Access is attributed to the macmail binary (and it appears in the FDA list by
// name) rather than the launching terminal. No-op except for the compiled
// binary's FDA-needing subcommands; may re-exec this process in place.
reexecWithDisclaim();

function withInlineScript<T>(content: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'macmail-as-'));
  const path = join(dir, 'script.applescript');
  writeFileSync(path, content);
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Read commands (triage / search) treat an unset/empty selector as "every
// account": the mailbox-URL LIKE pattern becomes %/<mailbox>, matching that
// mailbox under every account. Set MACMAIL_DEFAULT_ACCOUNT to a description /
// email / UUID to scope to the account you use most. Write commands (mark /
// reply) can't act on "all accounts" — they require an explicit selector.
const DEFAULT_ACCOUNT = process.env.MACMAIL_DEFAULT_ACCOUNT ?? '';
const DEFAULT_MAILBOX = process.env.MACMAIL_DEFAULT_MAILBOX ?? 'INBOX';

function requireFda(): void {
  if (canReadMailDir()) return;
  const opened = promptFullDiskAccess();
  if (opened) {
    console.error(
      'macmail: Full Disk Access required. In the Settings window that just opened, ' +
        'turn on "macmail" in the Full Disk Access list (it should now appear). ' +
        `If it isn't listed, click + and add this (the .app, not the inner binary): ${fdaGrantTarget()}. ` +
        'Then re-run your command — no terminal restart needed.',
    );
  } else {
    console.error(
      'macmail: Full Disk Access required to read ~/Library/Mail. ' +
        'Open System Settings → Privacy & Security → Full Disk Access and turn on "macmail" ' +
        `(or click + and add this — the .app, not the inner binary: ${fdaGrantTarget()}).`,
    );
  }
  process.exit(2);
}

/** Warn (to stderr) when an explicit account selector matched nothing, so an
 *  empty read result reads as "wrong account" rather than "no mail". */
function warnIfUnmatched(res: AccountResolution, selector: string): void {
  if (!res.unmatched) return;
  const hint = process.env.MACMAIL_DEFAULT_ACCOUNT
    ? "Run 'macmail accounts' to list configured accounts."
    : "Run 'macmail accounts' to list them, or omit --account to span all accounts.";
  console.error(
    `macmail: account '${selector}' matched no configured account — ` +
      `result will be empty. ${hint}`,
  );
}

/** Write commands act on one Mail.app account at a time; there is no "all"
 *  fallback, so an empty selector is a hard error with an actionable hint. */
function requireWriteAccount(account: string, cmd: string): void {
  if (account) return;
  throw new Error(
    `${cmd}: an account is required — pass --account <name> or set ` +
      `MACMAIL_DEFAULT_ACCOUNT (write commands target one account at a time)`,
  );
}

const program = new Command();
program
  .name('macmail')
  .description('macOS Mail.app CLI — file-based reads, AppleScript writes')
  .version(pkg.version)
  .addHelpText(
    'after',
    `
Examples:
  Discover your accounts and mailboxes:
    $ macmail accounts
    $ macmail mailboxes --filter Work

  Triage unread mail, newest first (spans all accounts unless scoped):
    $ macmail triage
    $ macmail triage --account Work --max 5

  Search by subject, body, date, sender, or state:
    $ macmail search 'invoice'
    $ macmail search 'release notes' --in body --snippet
    $ macmail search --since today --unread
    $ macmail search --sender alice --json

  Read a message (the id comes from triage / search):
    $ macmail read 2197647 --headers

  Write — preview with --dry-run, commit with --yes:
    $ macmail mark 2197647 read --yes
    $ macmail reply 2197647 --body 'On it' --yes
    $ macmail send --to bob@example.com --subject 'Lunch?' --body '12:30?' --dry-run

The id in the first column of triage / search output is what you pass to
read, mark, and reply. Run 'macmail <command> --help' for per-command flags.`,
  );

program
  .command('accounts')
  .description('List configured Mail.app accounts')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail accounts          # name, email, and type per account
  $ macmail accounts --json   # also include the account UUID

Use the name, email, or UUID anywhere --account is accepted.`,
  )
  .option('--json', 'NDJSON output')
  .action((opts) => {
    requireFda();
    process.stdout.write(runAccounts({ json: !!opts.json }));
  });

program
  .command('mailboxes')
  .description('List Envelope-Index mailboxes (optionally filtered)')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail mailboxes                       # every mailbox, all accounts
  $ macmail mailboxes --filter Work         # mailboxes in the "Work" account
  $ macmail mailboxes --filter INBOX        # every INBOX-named mailbox, any account
  $ macmail mailboxes --filter Work --json  # full URLs + total/unread counts`,
  )
  .option('--json', 'NDJSON output')
  .option(
    '--filter <pattern>',
    'case-insensitive URL substring; account name/email/UUID is resolved first',
  )
  .action((opts) => {
    requireFda();
    // Run the filter through the same account selector resolver as triage /
    // search so an account description / email matches its UUID-based URL.
    // Strings that don't resolve to an account fall through unchanged, so
    // `--filter INBOX` keeps its plain substring semantics.
    const filter = opts.filter ? resolveAccountSelector(opts.filter) : undefined;
    process.stdout.write(
      runMailboxesWithDefaultIndex({ json: !!opts.json, filter }),
    );
  });

program
  .command('read <id>')
  .description('Print a message body (and optionally headers / HTML)')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail read 2197588            # plain-text body
  $ macmail read 2197588 --headers  # prepend From/To/Date/Subject/Message-ID
  $ macmail read 2197588 --html     # HTML body instead of plain text
  $ macmail read 2197588 --json     # all fields as one JSON object

The id comes from the first column of triage / search output.`,
  )
  .option('--json', 'JSON output with all fields')
  .option('--headers', 'prepend From/To/Date/Subject/Message-ID block')
  .option('--html', 'return the HTML body instead of plain text')
  .action(async (idStr: string, opts) => {
    requireFda();
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error('id must be an integer');
    const out = await runRead(id, {
      json: !!opts.json,
      headers: !!opts.headers,
      html: !!opts.html,
    });
    process.stdout.write(out);
  });

program
  .command('search [query]')
  .description('Keyword search (subject via Envelope Index SQL, body via Envelope Index ∩ .emlx grep)')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail search 'invoice'                     # subject match (fast, pure SQL)
  $ macmail search 'release notes' --in body     # search inside bodies (reads .emlx)
  $ macmail search 'deploy' --in body --snippet  # one-line body excerpt per hit
  $ macmail search --since today --unread        # unread that arrived today
  $ macmail search --since 1w --until today      # last week, through yesterday
  $ macmail search --sender alice --flagged      # filter-only — no query needed
  $ macmail search 'incident' --in body --count-only  # totals only, no rows

Default scope is --in subject; default --max is 10. --since/--until accept
YYYY-MM-DD, MM-DD, or a token (today/yesterday/Nd/Nw) at local midnight.`,
  )
  .option('--json', 'NDJSON output (final line is a {_summary} object)')
  .option('--account <pattern>', 'account description / email / UUID; omit to span all accounts', DEFAULT_ACCOUNT)
  .option('--mailbox <name>', 'mailbox name (view or storage)', DEFAULT_MAILBOX)
  .option('--in <scope>', 'search scope: subject | body | both', 'subject')
  .option('--days <n>', 'narrow to messages from the last N days (overridden by --since)', '0')
  .option(
    '--since <date>',
    'lower bound: YYYY-MM-DD, MM-DD, or relative (today/yesterday/Nd/Nw); local midnight; overrides --days',
  )
  .option(
    '--until <date>',
    'exclusive upper bound: YYYY-MM-DD, MM-DD, or relative (today/yesterday/Nd/Nw); local midnight',
  )
  .option('--sender <pattern>', 'substring match against sender address / display name')
  .option('--to <pattern>', 'substring match against any recipient address')
  .option('--unread', 'only unread messages')
  .option('--flagged', 'only flagged messages')
  .option('--count-only', 'print totals and exit, do not pull rows')
  .option(
    '--snippet [chars]',
    'attach ±N chars of body context (default: 80; --in body / both only)',
  )
  .option(
    '--body [chars]',
    'attach the full decoded text body to each row (truncate to N when given)',
  )
  .option('--max <n>', 'maximum rows when not --count-only', '10')
  .action(async (query: string | undefined, opts) => {
    requireFda();
    const scope = opts.in as SearchScope;
    if (!['subject', 'body', 'both'].includes(scope)) {
      throw new Error(`--in must be subject|body|both (got '${opts.in}')`);
    }
    const max = Number.parseInt(opts.max, 10);
    if (!Number.isFinite(max) || max <= 0) throw new Error('--max must be a positive integer');
    const days = Number.parseInt(opts.days, 10);
    if (!Number.isFinite(days) || days < 0) throw new Error('--days must be a non-negative integer');

    // Body search needs a query to grep against the .emlx body. Subject /
    // both can still work as filter-only when --sender / --since / etc.
    // narrow the set, so we let an empty query through there.
    const hasQuery = typeof query === 'string' && query.length > 0;
    if (!hasQuery && scope === 'body') {
      throw new Error('--in body requires a query');
    }

    // --since beats --days when both are given.
    const sinceUnixSec = opts.since
      ? parseSearchDate(opts.since)
      : relativeDaysToUnixSec(days);
    const untilUnixSec = opts.until ? parseSearchDate(opts.until) : undefined;

    // --snippet without a value is boolean true → use default 80 chars.
    let snippet: number | undefined;
    if (opts.snippet !== undefined) {
      const raw = opts.snippet === true ? 80 : Number(opts.snippet);
      if (!Number.isFinite(raw) || raw < 0) {
        throw new Error('--snippet must be a non-negative integer');
      }
      snippet = raw;
    }

    // --body without a value is boolean true → 0 (full body).
    let body: number | undefined;
    if (opts.body !== undefined) {
      const raw = opts.body === true ? 0 : Number(opts.body);
      if (!Number.isFinite(raw) || raw < 0) {
        throw new Error('--body must be a non-negative integer');
      }
      body = raw;
    }

    const filters: EnvelopeFilters = {
      sender: opts.sender,
      recipient: opts.to,
      sinceUnixSec,
      untilUnixSec,
      unread: !!opts.unread,
      flagged: !!opts.flagged,
    };

    // Resolve a description / email / UUID-substring to the V<N>/UUID
    // directory name so the Envelope Index URL LIKE pattern can match; an
    // empty selector stays empty and spans all accounts.
    const acct = resolveAccountSelectorVerbose(opts.account);
    warnIfUnmatched(acct, opts.account);

    const outcome = await runSearchWithDefaultIndex({
      json: !!opts.json,
      account: acct.value,
      mailbox: opts.mailbox,
      query: hasQuery ? query : undefined,
      scope,
      max,
      filters,
      countOnly: !!opts.countOnly,
      snippet,
      body,
    });
    process.stdout.write(
      formatSearchOutput(outcome, {
        json: !!opts.json,
        max,
        countOnly: !!opts.countOnly,
      }),
    );
  });

program
  .command('triage')
  .description('Show unread messages in a mailbox (newest first)')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail triage                          # unread INBOX, all accounts (or default)
  $ macmail triage --max 5                  # 5 newest unread
  $ macmail triage --mailbox JIRA           # a different mailbox
  $ macmail triage --account Work           # scope to one account
  $ macmail triage --json | jq -r .subject  # subjects only`,
  )
  .option('--json', 'NDJSON output')
  .option('--account <pattern>', 'account description / email / UUID; omit to span all accounts (default: $MACMAIL_DEFAULT_ACCOUNT)', DEFAULT_ACCOUNT)
  .option('--mailbox <name>', 'trailing mailbox path component (default: $MACMAIL_DEFAULT_MAILBOX or "INBOX")', DEFAULT_MAILBOX)
  .option('--max <n>', 'maximum results', '20')
  .action((opts) => {
    requireFda();
    const max = Number.parseInt(opts.max, 10);
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error('--max must be a positive integer');
    }
    // See `search` above — translate the selector to the on-disk UUID; an
    // empty selector stays empty and spans all accounts.
    const acct = resolveAccountSelectorVerbose(opts.account);
    warnIfUnmatched(acct, opts.account);
    process.stdout.write(
      runTriageWithDefaultIndex({
        json: !!opts.json,
        account: acct.value,
        mailbox: opts.mailbox,
        max,
      }),
    );
  });

program
  .command('mark <id> <state>')
  .description('Mark a message read or unread (Mail.app must be running)')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail mark 2197647 read --dry-run   # preview, don't mutate Mail.app
  $ macmail mark 2197647 read --yes       # mark read (skip confirmation)
  $ macmail mark 2197647 unread --yes     # mark unread`,
  )
  .option('--account <pattern>', 'account', DEFAULT_ACCOUNT)
  .option('--mailbox <name>', 'mailbox', DEFAULT_MAILBOX)
  .option('--dry-run', "preview only, don't mutate Mail.app")
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (idStr: string, stateStr: string, opts) => {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error('id must be an integer');
    if (stateStr !== 'read' && stateStr !== 'unread') {
      throw new Error(`state must be 'read' or 'unread' (got '${stateStr}')`);
    }
    requireWriteAccount(opts.account, 'mark');
    await withInlineScript(MARK_APPLESCRIPT, async (path) => {
      const out = await runMark(
        {
          account: opts.account,
          mailbox: opts.mailbox,
          id,
          state: stateStr as MarkState,
          dryRun: !!opts.dryRun,
          yes: !!opts.yes,
        },
        { scriptPath: path },
      );
      process.stdout.write(out);
    });
  });

program
  .command('send')
  .description('Send (or draft) a new message')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail send --to bob@example.com --subject 'Lunch?' --body '12:30?' --dry-run
  $ macmail send --to bob@example.com --subject 'Lunch?' --body '12:30?' --yes
  $ macmail send --to a@x.com --cc b@x.com,c@x.com --subject 'Report' --body '...' --yes
  $ macmail send --to team@x.com --subject 'Plan' --body 'WIP' --draft

--dry-run previews, --yes sends without the prompt, --draft saves to Drafts.`,
  )
  .requiredOption('--to <email>', 'recipient')
  .requiredOption('--subject <text>', 'subject line')
  .requiredOption('--body <text>', 'message body')
  .option('--cc <email>', 'cc recipient(s), comma-separated', '')
  .option('--bcc <email>', 'bcc recipient(s), comma-separated', '')
  .option('--draft', 'save as draft instead of sending')
  .option('--dry-run', 'preview only')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (opts) => {
    await withInlineScript(SEND_APPLESCRIPT, async (path) => {
      const out = await runSend(
        {
          to: opts.to,
          subject: opts.subject,
          body: opts.body,
          cc: opts.cc,
          bcc: opts.bcc,
          draft: !!opts.draft,
          dryRun: !!opts.dryRun,
          yes: !!opts.yes,
        },
        { scriptPath: path },
      );
      process.stdout.write(out);
    });
  });

program
  .command('reply <id>')
  .description('Reply (or reply-all) to a message')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail reply 2197588 --body 'On it' --yes          # reply to sender
  $ macmail reply 2197588 --body '+team' --all --yes    # reply-all
  $ macmail reply 2197588 --body 'later' --draft        # save reply to Drafts
  $ macmail reply 2197588 --body 'wip' --all --dry-run  # preview reply-all`,
  )
  .requiredOption('--body <text>', 'reply body')
  .option('--account <pattern>', 'account', DEFAULT_ACCOUNT)
  .option('--mailbox <name>', 'mailbox', DEFAULT_MAILBOX)
  .option('--all', 'reply-all')
  .option('--draft', 'save as draft instead of sending')
  .option('--dry-run', 'preview only')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (idStr: string, opts) => {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error('id must be an integer');
    requireWriteAccount(opts.account, 'reply');
    await withInlineScript(REPLY_APPLESCRIPT, async (path) => {
      const out = await runReply(
        {
          account: opts.account,
          mailbox: opts.mailbox,
          id,
          body: opts.body,
          all: !!opts.all,
          draft: !!opts.draft,
          dryRun: !!opts.dryRun,
          yes: !!opts.yes,
        },
        { scriptPath: path },
      );
      process.stdout.write(out);
    });
  });

program
  .command('completions')
  .description('Print the shell completion script, or install it with --install')
  .addHelpText(
    'after',
    `
Examples:
  $ macmail completions --install               # install for your $SHELL
  $ macmail completions --shell zsh --install   # install zsh completion
  $ source <(macmail completions --shell zsh)   # or source it (add to ~/.zshrc to persist)

--install writes under $XDG_DATA_HOME (default ~/.local/share) and prints how to
enable it. The zsh script self-registers when sourced, so no install.sh needed.`,
  )
  .option('--shell <name>', 'zsh | bash (default: inferred from $SHELL)')
  .option(
    '--install',
    'write the script to the standard location and print how to enable it',
  )
  .action((opts) => {
    // No requireFda(): this is a setup command and reads no mail.
    process.stdout.write(
      runCompletions({ shell: opts.shell, install: !!opts.install }),
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`macmail: ${err.message ?? err}`);
  process.exit(1);
});
