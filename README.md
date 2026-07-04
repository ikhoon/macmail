<p align="center">
  <img src="assets/macmail-logo.png" alt="macmail logo" width="160" height="160">
</p>

<h1 align="center">macmail</h1>

<p align="center">
  <b>A fast, scriptable CLI for macOS Mail.app.</b><br>
  Triage, search, read, and reply to your mail from the terminal — no Gmail API, no IMAP, no OAuth.
</p>

<p align="center">
  <a href="https://github.com/ikhoon/macmail/actions/workflows/ci.yml"><img src="https://github.com/ikhoon/macmail/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ikhoon/macmail/releases/latest"><img src="https://img.shields.io/github/v/release/ikhoon/macmail?sort=semver&color=2ea043" alt="Latest release"></a>
  <a href="https://github.com/ikhoon/homebrew-tap"><img src="https://img.shields.io/badge/brew-ikhoon%2Ftap%2Fmacmail-f9a825?logo=homebrew&logoColor=white" alt="Homebrew"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ikhoon/macmail?color=blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white" alt="macOS · Apple Silicon">
</p>

<p align="center">
  <sub>Part of the <code>mac*</code> family ·
  <a href="https://github.com/ikhoon/maccal">maccal</a> (calendar) ·
  <a href="https://github.com/ikhoon/macrec">macrec</a> (meeting recorder)</sub>
</p>

## Highlights

- ⚡ **Instant on huge mailboxes** — millisecond reads over 100k+ messages via Mail's SQLite Envelope Index.
- 🔌 **No cloud, no setup** — no Gmail API, no IMAP, no OAuth; reads work offline, even with Mail.app closed.
- 🌏 **Decodes everything** — MIME, base64, quoted-printable; Korean and any other non-ASCII subject or body.
- 🔎 **Real search** — subjects or full bodies, with sender / date / unread / flagged filters and snippets.
- 🤖 **Built for scripts & LLMs** — `--json` (NDJSON) on every command; pipe straight into `jq` or an agent.
- ✍️ **Safe writes** — `mark` / `send` / `reply` go through your own Mail.app; preview with `--dry-run`.

```console
$ macmail triage --account Work --max 3
2197647   CI Bot <ci@example.com>           Build #1242 failed: deploy …   2026-06-01T16:17:23+09:00
2197621   GitHub <noreply@github.com>       PR #4823 review requested       2026-06-01T15:21:06+09:00
2197588   Jira <jira@example.com>           [PROJ-1201] assigned to you     2026-06-01T14:02:10+09:00
```

Reads go straight through Mail's local files; writes go through Mail.app via AppleScript.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start) — copy-paste cheat sheet
- [Commands](#commands)
  - Read: [`accounts`](#accounts) · [`mailboxes`](#mailboxes) · [`triage`](#triage) · [`read`](#read) · [`search`](#search)
  - Write: [`mark`](#mark) · [`send`](#send) · [`reply`](#reply)
- [Configuration](#configuration) — set your default account
- [Scripting with JSON](#scripting-with-json)
- [Shell completion](#shell-completion)
- [Troubleshooting](#troubleshooting)
- [Full Disk Access](#full-disk-access-one-time) · [Privacy](#privacy) · [How it works](#how-it-works) · [Requirements](#requirements) · [Development](#development)

---

## Install

> Apple Silicon (arm64) only for now.

### Homebrew (recommended)

```bash
brew install ikhoon/tap/macmail
```

### From a release

Download `macmail-<version>-macos-arm64.zip` from
[Releases](https://github.com/ikhoon/macmail/releases), unzip it, and run
`./install.sh` (it clears the download quarantine and installs the app).

> The first read command (e.g. `macmail triage`) prompts once for **Full Disk
> Access** — mostly automatic now; see [Full Disk Access](#full-disk-access-one-time)
> if the grant needs a nudge.

---

## Quick start

Everything you need for daily use. Copy, paste, adjust.

```bash
# DISCOVER ─────────────────────────────────────────────────────────────
macmail accounts                          # which accounts exist (name / email / type)
macmail mailboxes --filter Work           # mailboxes in the "Work" account
export MACMAIL_DEFAULT_ACCOUNT=Work       # optional: scope reads to one account (add to ~/.zshrc)

# TRIAGE (unread, newest first) ─────────────────────────────────────────
macmail triage                            # unread INBOX — all accounts, or your default if set
macmail triage --max 5                    # just the 5 newest unread
macmail triage --mailbox JIRA             # unread in a specific mailbox

# SEARCH ────────────────────────────────────────────────────────────────
macmail search 'invoice'                  # subject contains "invoice"
macmail search '초대장'                    # works in Korean too
macmail search 'release notes' --in body  # search inside message bodies
macmail search --since today              # everything that arrived today
macmail search --sender alice --unread    # unread from anyone matching "alice"
macmail search 'deploy' --in body --snippet   # show a one-line body excerpt per hit

# READ ──────────────────────────────────────────────────────────────────
macmail read 2197647                      # print the body (id comes from triage/search)
macmail read 2197647 --headers            # with From/To/Date/Subject

# WRITE (preview first, then commit) ────────────────────────────────────
macmail mark 2197647 read --dry-run       # see what would happen
macmail mark 2197647 read --yes           # actually mark it read
macmail reply 2197647 --body "On it 👍" --yes
macmail send --to bob@example.com --subject "Lunch?" --body "12:30?" --dry-run
```

> **The message `id`** in the first column of `triage` / `search` output is what
> you pass to `read`, `mark`, and `reply`.

---

## Commands

Two kinds of commands:

| | Commands | Needs |
|---|---|---|
| **Read** (no side effects) | `accounts` `mailboxes` `triage` `read` `search` | Full Disk Access |
| **Write** (mutates Mail) | `mark` `send` `reply` | Mail.app running (auto-launched) |

Common conventions:

- `--json` on every command → **NDJSON** (one JSON object per line), for `jq`.
- `--account` / `--mailbox` default to `$MACMAIL_DEFAULT_ACCOUNT` / `$MACMAIL_DEFAULT_MAILBOX` (see [Configuration](#configuration)). On read commands (`triage` / `search`), an unset `--account` spans **all** accounts.
- Write commands take `--dry-run` (preview) and `-y` / `--yes` (skip the confirmation prompt).

---

### `accounts`

List the Mail.app accounts macmail can see.

```console
$ macmail accounts
Work        you@company.com      Gmail
Personal    you@gmail.com        iCloud
```

```bash
macmail accounts --json        # adds the account UUID
```

Use the **name** (`Work`), **email**, or **UUID** anywhere `--account` is accepted.

---

### `mailboxes`

List mailboxes from the Envelope Index. Text mode prints short names; `--json`
adds the full URL and message counts.

```console
$ macmail mailboxes --filter Work
INBOX
[Gmail]/Sent Mail
[Gmail]/All Mail
JIRA
GITHUB
```

```bash
macmail mailboxes                       # every mailbox, all accounts
macmail mailboxes --filter Work         # mailboxes in the "Work" account
macmail mailboxes --filter INBOX        # every INBOX-named mailbox, any account
macmail mailboxes --filter Work --json  # full URLs + total/unread counts
```

| Flag | Description |
|---|---|
| `--filter <pattern>` | Account name/email/UUID (resolved first), else a plain URL substring |
| `--json` | NDJSON with `name`, `url`, `total`, `unread` |

---

### `triage`

Unread messages in a mailbox, newest first. Your morning inbox scan. With no
`--account` (and no `$MACMAIL_DEFAULT_ACCOUNT`), it spans **every** account.

```console
$ macmail triage --account Work --max 3
2197647   CI Bot <ci@example.com>           Build #1242 failed: deploy …   2026-06-01T16:17:23+09:00
2197621   GitHub <noreply@github.com>       PR #4823 review requested       2026-06-01T15:21:06+09:00
2197588   Jira <jira@example.com>           [PROJ-1201] assigned to you     2026-06-01T14:02:10+09:00
```

Columns: `id`, `sender`, `subject`, `date` (local time). When the result spans
more than one account, an `account` column is inserted after `id`.

```bash
macmail triage                          # unread INBOX across all accounts (or your default)
macmail triage --max 5                  # 5 newest
macmail triage --mailbox JIRA           # a different mailbox
macmail triage --account Work           # scope to one account
macmail triage --json | jq -r .subject  # subjects only
```

| Flag | Default | Description |
|---|---|---|
| `--account <pattern>` | `$MACMAIL_DEFAULT_ACCOUNT` (else **all accounts**) | Account name / email / UUID |
| `--mailbox <name>` | `$MACMAIL_DEFAULT_MAILBOX` or `INBOX` | Mailbox name |
| `--max <n>` | `20` | Max results |
| `--json` | — | NDJSON output |

---

### `read`

Print one message. The `id` comes from `triage` or `search`.

```console
$ macmail read 2197588 --headers
From: Jira <jira@example.com>
To: you@company.com
Date: 2026-06-01T14:02:10+09:00
Subject: [PROJ-1201] assigned to you
Message-ID: <JIRA.1201.abc@example.com>

You have been assigned PROJ-1201 "Tune the rate limiter".
…
```

```bash
macmail read 2197588                    # plain-text body only
macmail read 2197588 --headers          # prepend From/To/Date/Subject/Message-ID
macmail read 2197588 --html             # HTML body instead of plain text
macmail read 2197588 --json             # every field as one JSON object
```

| Flag | Description |
|---|---|
| `--headers` | Prepend an RFC822-style header block |
| `--html` | Return the HTML body instead of plain text |
| `--json` | All fields (`from`, `to`, `subject`, `date`, `text`, `html`, `flags`, …) |

---

### `search`

The most powerful command. Combines a **content match** (subject and/or body)
with **structured filters** (sender, recipient, date range, unread, flagged).

```console
$ macmail search 'release notes' --in body --mailbox JIRA --days 14 --snippet
2196120   Jira <jira@example.com>   [PROJ-980] Release notes for 3.4   2026-05-28T09:11:02+09:00   …please review the release notes before Friday's cut…
```

Default scope is `--in subject`; default `--max` is `10`.

#### Search by scope

```bash
macmail search 'invoice'                       # subject (default, fast — pure SQL)
macmail search 'kubernetes' --in body          # inside message bodies (reads .emlx files)
macmail search 'kubernetes' --in both          # subject OR body
```

> **Body search only sees messages whose `.emlx` is on disk.** Mail.app keeps
> some bodies server-side-only depending on its cache settings; those are
> invisible to body search until you open them once in Mail.app. Body search
> needs a query (there must be something to grep for); subject search can run
> filter-only.

#### Search by date

`--since` / `--until` accept an absolute date or a relative token, snapped to
**local midnight**. `--until` is **exclusive**.

| Token | Means |
|---|---|
| `2026-05-27` | that exact day (`YYYY-MM-DD`) |
| `05-27` | that day in the current year (`MM-DD`) |
| `today` / `yesterday` | local calendar day |
| `7d` / `2w` | 7 days / 2 weeks ago |

```bash
macmail search --since today                   # arrived today
macmail search --since yesterday               # since yesterday 00:00
macmail search --since 1w --until today        # last week, through end of yesterday
macmail search 'budget' --since 2026-05-01 --until 2026-06-01   # all of May
macmail search 'alert' --in body --days 3      # bodies, last 3 days (--since overrides --days)
```

#### Search by sender / recipient / state

```bash
macmail search --sender alice                  # from anyone matching "alice"
macmail search --to support@company.com        # addressed to support@
macmail search --unread --flagged              # unread AND flagged (filter-only, no query)
macmail search 'urgent' --sender boss --unread # combine freely
```

#### Probe before you pull (recommended workflow)

1. **Count first.** `--count-only` returns totals without hydrating rows — cheap,
   and tells you whether `--max` will hide matches.
2. **Narrow with filters** (`--sender`, `--since`, `--unread`, …) before raising `--max`.
3. **Add `--snippet`** on body hits for a one-line excerpt — judge relevance
   without a `read` per result.

```console
$ macmail search 'deploy' --in body --count-only
total: 42
examined: 318          # .emlx files actually read (body path only)
```

```bash
macmail search 'deploy' --in body --max 25            # then pull more if needed
macmail search 'deploy' --in body --snippet 120       # ±120 chars of context
macmail search 'deploy' --in body --body              # attach the full decoded body
```

When results are capped, text mode prints a trailer so you know:
`(showing 10 of 42 — narrow filters if too many)`.

#### All `search` flags

| Flag | Default | Description |
|---|---|---|
| `[query]` | — | Text to match. Optional for `subject`/`both` when filters narrow the set; **required** for `body` |
| `--in <scope>` | `subject` | `subject` \| `body` \| `both` |
| `--account <pattern>` | `$MACMAIL_DEFAULT_ACCOUNT` (else **all accounts**) | Account name / email / UUID |
| `--mailbox <name>` | `$MACMAIL_DEFAULT_MAILBOX` or `INBOX` | View or storage mailbox |
| `--max <n>` | `10` | Max rows (ignored with `--count-only`) |
| `--since <date>` | — | Lower bound (date or token); overrides `--days` |
| `--until <date>` | — | Upper bound, **exclusive** |
| `--days <n>` | `0` | Last N days (relative to now) |
| `--sender <pattern>` | — | Substring match on sender address / name |
| `--to <pattern>` | — | Substring match on any recipient |
| `--unread` | — | Only unread |
| `--flagged` | — | Only flagged |
| `--count-only` | — | Print `total` (and `examined` for body), then exit |
| `--snippet [chars]` | `80` | ±N chars of body context per hit (`body`/`both`) |
| `--body [chars]` | full | Attach the decoded body (truncate to N when given) |
| `--json` | — | NDJSON; final line is a `{"_summary": {…}}` object |

---

### `mark`

Mark a message read or unread. **Mutates Mail.app** — preview with `--dry-run`.

```console
$ macmail mark 2197647 read --dry-run
DRY-RUN: would mark message 2197647 (Work/INBOX) as read

$ macmail mark 2197647 read --yes
ok
```

```bash
macmail mark 2197647 read               # prompts for confirmation
macmail mark 2197647 unread --yes       # skip the prompt
```

| Argument / Flag | Description |
|---|---|
| `<id> <read\|unread>` | Message id and target state |
| `--account` / `--mailbox` | Where the message lives (defaults as above) |
| `--dry-run` | Preview only |
| `-y`, `--yes` | Skip the confirmation prompt |

---

### `send`

Compose a new message. **Sends for real** unless `--draft` or `--dry-run`.

```console
$ macmail send --to bob@example.com --subject "Lunch?" --body "12:30 at the usual?" --dry-run
DRY-RUN: would send
  To:      bob@example.com
  Cc:
  Bcc:
  Subject: Lunch?

12:30 at the usual?
```

```bash
macmail send --to bob@example.com --subject "Hi" --body "..." --yes
macmail send --to a@x.com --cc b@x.com,c@x.com --subject "Report" --body "Attached." --yes
macmail send --to team@x.com --subject "Draft" --body "WIP" --draft   # save to Drafts, don't send
```

| Flag | Required | Description |
|---|:---:|---|
| `--to <email>` | ✓ | Recipient(s) |
| `--subject <text>` | ✓ | Subject line |
| `--body <text>` | ✓ | Message body |
| `--cc` / `--bcc <email>` | | Comma-separated extra recipients |
| `--draft` | | Save to Drafts instead of sending |
| `--dry-run` | | Preview only |
| `-y`, `--yes` | | Skip the confirmation prompt |

---

### `reply`

Reply (or reply-all) to an existing message by `id`.

```console
$ macmail reply 2197588 --body "Thanks, taking a look." --all --dry-run
DRY-RUN: would send reply-all
  Target:  message 2197588 (Work/INBOX)
  Mode:    reply-all
  Body:

Thanks, taking a look.
```

```bash
macmail reply 2197588 --body "On it 👍" --yes        # reply to sender
macmail reply 2197588 --body "+team" --all --yes     # reply-all
macmail reply 2197588 --body "draft this" --draft    # save reply to Drafts
```

| Flag | Required | Description |
|---|:---:|---|
| `<id>` | ✓ | Message to reply to |
| `--body <text>` | ✓ | Reply body |
| `--all` | | Reply to all recipients |
| `--draft` | | Save to Drafts instead of sending |
| `--dry-run` | | Preview only |
| `-y`, `--yes` | | Skip the confirmation prompt |

---

## Configuration

Set your most-used account and mailbox once, in your shell rc, to drop the
`--account` / `--mailbox` flags everywhere:

```bash
# ~/.zshrc or ~/.bashrc
export MACMAIL_DEFAULT_ACCOUNT=Work     # name, email, or UUID
export MACMAIL_DEFAULT_MAILBOX=INBOX    # the default mailbox
```

`--account` accepts an account **description** (`Work`), a **login email**
(`you@company.com`), or a Mail **UUID** — whatever's handy. If nothing matches,
the raw value is used as a substring (and read commands print a warning, since
the result will be empty). Run `macmail accounts` to see your options.

When `MACMAIL_DEFAULT_ACCOUNT` is unset and you don't pass `--account`, the read
commands (`triage`, `search`) span **all** accounts, and `triage` adds an
`account` column whenever the rows cover more than one. The write commands
(`mark`, `reply`) can't act on "all accounts", so they require an explicit
`--account` (or the env var).

---

## Scripting with JSON

Every command supports `--json` (NDJSON — one object per line). `search` appends
a final `{"_summary": …}` line with `shown`, `total`, and (for body searches)
`examined`.

```bash
# Subjects of today's unread mail
macmail triage --json | jq -r '.subject'

# Sender + subject of body-search hits, skipping the summary line
macmail search 'incident' --in body --json \
  | jq -r 'select(._summary | not) | "\(.sender)\t\(.subject)"'

# How many unread match, without pulling rows
macmail search --unread --count-only --json | jq '._summary.total'

# Mark every unread message from a noisy sender as read
macmail search --sender noreply@ci.example.com --unread --json \
  | jq -r 'select(._summary | not) | .id' \
  | xargs -I{} macmail mark {} read --yes
```

---

## Shell completion

`install.sh` sets these up for you. To (re)install them yourself — handy for a
binary-only setup with no source tree — the binary emits and installs its own:

```bash
macmail completions --install                 # install for your $SHELL
macmail completions --shell zsh --install     # pick a shell explicitly
source <(macmail completions --shell zsh)     # or source it (add to your rc to persist)
```

Completions cover subcommands, flags, `--in` scopes, `mark` states, and dynamic
`--account` / `--mailbox` values. `--install` writes under `$XDG_DATA_HOME`
(default `~/.local/share`) and prints how to enable it. (zsh/bash only.)

**zsh** — either source it from `~/.zshrc` (self-registers, simplest)…

```zsh
# ~/.zshrc — after compinit runs, with macmail on $PATH
source <(macmail completions --shell zsh)
```

…or install the file (`--install`) and put its dir on `fpath` *before* `compinit`:

```zsh
# ~/.zshrc
fpath=(~/.local/share/zsh/site-functions $fpath)
autoload -Uz compinit && compinit
```

**bash** — auto-loaded by bash-completion@2. Otherwise:

```bash
# ~/.bashrc
source ~/.local/share/bash-completion/completions/macmail
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"Full Disk Access required"** / can't read mail | Grant FDA to `~/.local/bin/macmail` itself — see [Full Disk Access](#full-disk-access-one-time). |
| **Body search finds nothing** | The body isn't cached locally. Open the message once in Mail.app (or change its cache policy), then retry. |
| **`mark` / `send` / `reply` does nothing** | These need Mail.app; it auto-launches on first use. Confirm with `--dry-run` first. |
| **Wrong account / empty results** | Run `macmail accounts`, then set `MACMAIL_DEFAULT_ACCOUNT` or pass `--account`. |
| **`macmail: command not found`** | `~/.local/bin` isn't on `PATH`. Check with `which macmail`. |
| **Too many results** | The `(showing M of N)` trailer means you're capped — add filters or raise `--max`. |

---

## Full Disk Access (one-time)

Reading `~/Library/Mail` is blocked by macOS until you grant Full Disk Access.
The first read command pops a dialog with an **Open Settings** button.

**Grant FDA to `macmail` itself — not your terminal:**

1. Run a read command once (e.g. `macmail triage`), then click **Open Settings**
   in the dialog.
2. Under **Full Disk Access**, turn **macmail** on — it appears in the list **by
   name and icon**. (If it isn't listed yet, click **+** and add the app bundle
   `~/.local/lib/macmail.app` — not the inner binary.)
3. Done — no terminal restart needed.

macmail re-execs itself as its own TCC *responsible process* (codesign identity
`kr.ikhoon.macmail`), so the grant is keyed to **macmail**, not the launching
terminal — it shows up in the list to toggle and then works from any terminal
(Terminal.app, iTerm, cmux, VS Code, …). After a rebuild/reinstall you may need
to re-enable it. To opt out of the re-exec, set `MACMAIL_NO_DISCLAIM=1` (you'll
then grant the terminal instead).

---

## Privacy

macmail is local-first by design — nothing about your mail leaves your machine.

- **Reads never touch the network.** They go straight to Mail's local files
  (`~/Library/Mail`) and its Envelope Index — no IMAP, no Gmail/API, no OAuth, no
  cloud service, no telemetry.
- **Writes use the Mail.app you're already signed into.** `send` / `reply` /
  `mark` drive Mail via AppleScript, so macmail never handles your passwords,
  tokens, or SMTP credentials.
- **macmail stores nothing of its own** — no database, no cache; configuration is
  just environment variables you set.

---

## How it works

> Skip this unless you're curious or hacking on macmail.

Reads bypass Mail.app entirely; writes go through it via AppleScript.

```
macmail <subcommand>
   │
   ├── read paths (no Mail.app needed) ─┬─► Envelope Index SQLite (bun:sqlite)
   │                                    └─► .emlx files (mailparser)
   │
   └── write paths ─► osascript ─► lib/applescript/{mark,send,reply}.applescript
                                                └─► tell application "Mail"
```

**Why file-based reads?** Mail.app already syncs each account locally: every
message is an `.emlx` file under `~/Library/Mail/V<N>/<account-uuid>/<mailbox>.mbox/…`,
with a SQLite "Envelope Index" of per-message metadata and flags. Reading those
directly is fast and works even when Mail.app is closed — and it avoids Mail's
AppleScript runtime, which crashes on body searches over a large inbox.

**Design notes** — Mail.app quirks macmail is built around:

- **Full Disk Access is keyed to macmail, not your terminal.** macmail re-execs
  as its own TCC *responsible process* (codesign `kr.ikhoon.macmail`), so one
  grant works from every terminal (Terminal, iTerm, VS Code, …).
- **Reads never write.** macmail only *reads* the Envelope Index; every mutation
  (`mark` / `send` / `reply`) goes through Mail.app, so Mail's own state stays
  consistent and sends use your real authenticated account.
- **View mailboxes resolve to storage.** Gmail-style label/view mailboxes are
  mapped to the underlying `.mbox` so body reads find the actual `.emlx`.
- **Uncached bodies are invisible.** Body search only sees messages whose `.emlx`
  is on disk; Mail keeps some server-side until you open them once — a Mail
  limitation, not a macmail bug.

*Non-goals: maildir, IMAP, server-side rules, calendar/contacts.*

<details>
<summary>Per-subcommand internals</summary>

- **`accounts`** — enumerates UUID directories under `~/Library/Mail/V<N>/`,
  joined against `~/Library/Accounts/Accounts4.sqlite` for description, login
  email, and account type.
- **`mailboxes`** — `SELECT url, total_count, unread_count FROM mailboxes`. The
  `--filter` runs through the same account-selector resolver as `--account`
  (description / email / UUID → UUID), with plain URL substring as fallback.
- **`triage`** — SQL over the Envelope Index, restricted to the matching mailbox
  URL and unread-and-not-deleted (`(flags & 1) = 0 AND (flags & 2) = 0`).
  Handles both storage mailboxes (`source IS NULL`) and Gmail-style view
  mailboxes (`source IS NOT NULL`, joined through the `labels` table).
- **`search --in subject`** — SQL `LIKE` against the indexed `subjects` table
  plus the structured filters.
- **`search --in body` / `both`** — the Envelope Index narrows to candidate
  message IDs, then each candidate's storage `.emlx` is read via `mailparser`
  and grepped. View mailboxes resolve to their storage mbox automatically.
  Bodies Mail.app hasn't downloaded are invisible (a Mail.app limitation).
- **`read <id>`** — locates `<id>.emlx` under `~/Library/Mail`, parses with
  `mailparser` (correct MIME / base64 / quoted-printable decoding).
- **`mark` / `send` / `reply`** — wrap embedded AppleScript via `osascript`;
  Mail.app is auto-launched on first use.

</details>

---

## Requirements

- **Running it:** macOS on Apple Silicon (arm64), with **Mail.app set up and at
  least one account** synced locally. Nothing else — reads need no network and no
  tokens, and the binary is self-contained.
- **Building from source:** [Bun](https://bun.sh) 1.0+ on macOS (for `codesign`
  and the AppleScript write paths).

---

## Development

### Build & install from source

Requires [Bun](https://bun.sh) 1.0+.

```bash
git clone https://github.com/ikhoon/macmail ~/src/macmail
cd ~/src/macmail
./install.sh
```

`install.sh` compiles a self-contained binary, packages it as a
`~/.local/lib/macmail.app` bundle (so it shows up named + iconed in Full Disk
Access), symlinks the bundle's executable to `~/.local/bin/macmail`, and installs
shell completions. Make sure `~/.local/bin` is on your `PATH`:

```bash
which macmail        # → /Users/you/.local/bin/macmail
macmail --help
```

### Working on it

```bash
bun install              # fetch deps
bun test                 # CI tests — fixtures only, no Mail.app/FDA needed
bun run test:local       # integration tests against your real Mail store (needs FDA)
bun run typecheck        # tsc --noEmit
bun run dev -- accounts  # run from source without compiling
bun run build            # produce dist/macmail (codesigned)
```

Two test tiers:

- **`bun test`** — the CI tier: in-memory SQLite fixtures, fixture `.emlx` files,
  and a stub AppleScript. No Full Disk Access, no live Mail.app, no real mail.
  (Runs on a macOS runner; `tests/local/` is excluded via `--path-ignore-patterns`.)
- **`bun run test:local`** — integration tests in `tests/local/` that exercise
  the real `~/Library/Mail` store, so they need Full Disk Access. Skipped
  automatically when FDA isn't granted.

<details>
<summary>Project layout</summary>

```
macmail/
├── src/
│   ├── cli.ts                  # commander entry point
│   ├── commands/               # one handler per subcommand
│   │   ├── accounts.ts  mailboxes.ts  triage.ts  search.ts
│   │   └── read.ts  mark.ts  send.ts  reply.ts
│   ├── lib/
│   │   ├── mail-data.ts        # account discovery (V<N> dirs + Accounts4.sqlite)
│   │   ├── envelope.ts         # SQLite Envelope Index wrapper
│   │   ├── emlx.ts             # .emlx parser (mailparser + flags)
│   │   ├── output.ts           # text/NDJSON formatters
│   │   ├── confirm.ts          # /dev/tty y/N prompt
│   │   ├── osascript.ts        # runAppleScript + FDA gate
│   │   └── applescripts.ts     # embeds the write-op AppleScript bodies
│   └── types/
├── lib/applescript/            # hand-edited write-op AppleScripts
│   └── mark.applescript  send.applescript  reply.applescript
├── completions/                # _macmail (zsh), macmail.bash (bash)
├── tests/                      # bun test + smoke.sh against the binary
├── install.sh  package.json  tsconfig.json  LICENSE
```

</details>

---

## License

MIT
