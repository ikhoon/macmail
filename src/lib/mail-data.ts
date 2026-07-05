// mail-data.ts — locate Mail.app's data dir, enumerate accounts, and resolve
// free-form account selectors (UUID / description / email) to a UUID.
//
// Modern macOS (V10+) no longer ships ~/Library/Mail/V<N>/MailData/Accounts.plist.
// The source of truth for which accounts exist is the set of UUID-named
// directories under ~/Library/Mail/V<N>/ (each holds the .mbox files for one
// account). Human-friendly metadata — display name, email, account type —
// lives in the system-wide ~/Library/Accounts/Accounts4.sqlite, where each
// Mail child row references a parent row carrying the description/username.

import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Account {
  /** Mail V<N> UUID directory name (e.g. "BBBBBBBB-1111-2222-3333-444444444444"). */
  uuid: string;
  /** Human-readable description from Accounts4 (e.g. "Work", "Personal", "On My Mac"). */
  name: string;
  /** Login email from Accounts4 — null for local "On My Mac" accounts. */
  email: string | null;
  /** Account-type description (e.g. "Gmail", "iCloud", "IMAPMail", "On My Device"). */
  type: string;
}

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const MAIL_VERSION_CANDIDATES = ['V11', 'V10', 'V9', 'V8'];

export function findMailVersionDir(base: string = join(homedir(), 'Library', 'Mail')): string {
  for (const v of MAIL_VERSION_CANDIDATES) {
    const p = join(base, v);
    try {
      if (statSync(p).isDirectory()) return p;
    } catch {
      // missing — keep probing
    }
  }
  throw new Error(`could not find ~/Library/Mail/V<N> under ${base}`);
}

export function defaultEnvelopeIndexPath(): string {
  return join(findMailVersionDir(), 'MailData', 'Envelope Index');
}

export function defaultAccountsSqlitePath(): string {
  return join(homedir(), 'Library', 'Accounts', 'Accounts4.sqlite');
}

/** UUID-named subdirectories of `mailDir` — one per configured Mail account. */
export function listMailAccountUuids(mailDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(mailDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => UUID_RE.test(name))
    .filter((name) => {
      try {
        return statSync(join(mailDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

interface Enrichment {
  description: string | null;
  email: string | null;
  type: string | null;
}

/**
 * For the given Mail UUIDs, look up display name / email / type in
 * Accounts4.sqlite. Each Mail row is a *child* account whose ZPARENTACCOUNT
 * carries the real description/username (and a different account-type row,
 * e.g. "Gmail" for an IMAP child of a Gmail parent).
 */
export function readAccountEnrichments(
  sqlitePath: string,
  uuids: string[],
): Map<string, Enrichment> {
  const result = new Map<string, Enrichment>();
  if (uuids.length === 0) return result;
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const placeholders = uuids.map(() => '?').join(',');
    const rows = db
      .query<
        {
          uuid: string;
          childDesc: string | null;
          childUser: string | null;
          parentDesc: string | null;
          parentUser: string | null;
          childType: string | null;
          parentType: string | null;
        },
        string[]
      >(
        `SELECT child.ZIDENTIFIER          AS uuid,
                child.ZACCOUNTDESCRIPTION  AS childDesc,
                child.ZUSERNAME            AS childUser,
                parent.ZACCOUNTDESCRIPTION AS parentDesc,
                parent.ZUSERNAME           AS parentUser,
                ct.ZACCOUNTTYPEDESCRIPTION AS childType,
                pt.ZACCOUNTTYPEDESCRIPTION AS parentType
         FROM ZACCOUNT child
         LEFT JOIN ZACCOUNT parent     ON child.ZPARENTACCOUNT = parent.Z_PK
         LEFT JOIN ZACCOUNTTYPE ct     ON child.ZACCOUNTTYPE   = ct.Z_PK
         LEFT JOIN ZACCOUNTTYPE pt     ON parent.ZACCOUNTTYPE  = pt.Z_PK
         WHERE child.ZIDENTIFIER IN (${placeholders})`,
      )
      .all(...uuids);
    for (const r of rows) {
      result.set(r.uuid, {
        description: r.parentDesc ?? r.childDesc,
        email: r.parentUser ?? r.childUser,
        type: r.parentType ?? r.childType,
      });
    }
    return result;
  } finally {
    db.close();
  }
}

/**
 * List accounts by walking Mail UUID directories and (when available)
 * enriching each with description/email/type from Accounts4.sqlite. When the
 * Accounts DB is unreachable, returns UUID-only entries with type="Unknown".
 */
export function listAccountsFromSources(
  mailDir: string,
  accountsSqlitePath?: string | null,
): Account[] {
  const uuids = listMailAccountUuids(mailDir);
  const enrichments =
    accountsSqlitePath && existsSync(accountsSqlitePath)
      ? readAccountEnrichments(accountsSqlitePath, uuids)
      : new Map<string, Enrichment>();
  return uuids.map((uuid) => {
    const e = enrichments.get(uuid);
    return {
      uuid,
      name: e?.description ?? uuid,
      email: e?.email ?? null,
      type: e?.type ?? 'Unknown',
    };
  });
}

export function listAccounts(): Account[] {
  return listAccountsFromSources(findMailVersionDir(), defaultAccountsSqlitePath());
}

/**
 * Resolve a free-form account selector to a Mail UUID. Accepts:
 *   - exact UUID (matched case-insensitively)
 *   - exact description (e.g. "Work")
 *   - exact email (e.g. "user@example.com")
 *   - substring of description or email (first match wins)
 * Returns null when nothing matches.
 */
export function resolveAccountUuid(selector: string, accounts: Account[]): string | null {
  if (!selector) return null;
  const upper = selector.toUpperCase();
  const byUuid = accounts.find((a) => a.uuid.toUpperCase() === upper);
  if (byUuid) return byUuid.uuid;
  const lower = selector.toLowerCase();
  const byName = accounts.find((a) => a.name.toLowerCase() === lower);
  if (byName) return byName.uuid;
  const byEmail = accounts.find((a) => (a.email ?? '').toLowerCase() === lower);
  if (byEmail) return byEmail.uuid;
  const partial = accounts.find(
    (a) =>
      a.name.toLowerCase().includes(lower) ||
      (a.email ?? '').toLowerCase().includes(lower),
  );
  return partial ? partial.uuid : null;
}

/** Strip `scheme://authority/` from a Mail.app mailbox URL, leaving the decoded
 *  mailbox path (e.g. `imap://acct/dev/bomnun` → `dev/bomnun`). */
export function shortMailboxName(url: string): string {
  const m = url.match(/^[^:]+:\/\/[^/]+\/(.*)$/);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Convert a Mail.app mailbox URL into the on-disk directory that holds its
 * messages. `imap://<UUID>/A/B/C` → `<mailVersionDir>/<UUID>/A.mbox/B.mbox/
 * C.mbox`. Each URL path segment is decoded and appended with `.mbox`.
 * Returns null for unsupported schemes, malformed URLs, or empty paths.
 */
export function mailboxUrlToFsPath(
  url: string,
  mailVersionDir: string,
): string | null {
  if (!url) return null;
  const m = /^(imap|local):\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!m) return null;
  const acctId = m[2];
  const rawPath = m[3] ?? '';
  const segments = rawPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  if (segments.length === 0) return null;
  // Guard against a percent-encoded `../` (or a literal separator) in a segment
  // escaping the mail dir once decoded, e.g. `%2e%2e%2f`. The URL comes from the
  // trusted Envelope Index, so this is defense-in-depth.
  if (segments.some((s) => s === '.' || s === '..' || s.includes('/') || s.includes('\\'))) {
    return null;
  }
  const mboxSegs = segments.map((s) => `${s}.mbox`);
  return join(mailVersionDir, acctId, ...mboxSegs);
}

/**
 * Extract the account identifier from a mailbox URL — the authority component
 * of `scheme://<authority>/path`. For real Mail data this is the account's
 * UUID (`imap://BBBBBBBB-…/INBOX` → `BBBBBBBB-…`); in tests/fixtures it may be
 * an email-style authority. Returns null when there's no authority.
 */
export function accountIdFromMailboxUrl(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : null;
}

/** Outcome of resolving an account selector for the read path. */
export interface AccountResolution {
  /** The pattern to feed the mailbox-URL `LIKE`: a UUID when the selector
   *  matched a configured account, the original selector when it didn't, or
   *  `''` (match every account) when the selector was empty. */
  value: string;
  /** True only when a *non-empty* selector matched no configured account and
   *  the account list was readable — i.e. the query will almost certainly
   *  return nothing. Callers surface this as a warning. */
  unmatched: boolean;
}

/**
 * Resolve a selector the way the read commands (triage / search) want it:
 *   - empty selector          → match every account (`value: ''`)
 *   - matched account         → its UUID
 *   - non-empty, no match      → the selector unchanged, with `unmatched: true`
 *   - account list unreadable  → the selector unchanged, `unmatched: false`
 *     (we can't claim it didn't match if we couldn't look)
 */
export function resolveAccountSelectorVerbose(selector: string): AccountResolution {
  if (!selector) return { value: '', unmatched: false };
  try {
    const uuid = resolveAccountUuid(selector, listAccounts());
    if (uuid) return { value: uuid, unmatched: false };
    return { value: selector, unmatched: true };
  } catch {
    return { value: selector, unmatched: false };
  }
}

/**
 * Convenience: resolve a selector against the live account list, returning
 * the input unchanged when no account matches (so existing substring-style
 * selectors continue to work). Used by `mailboxes --filter`, where falling
 * through to a literal substring is the desired behaviour.
 */
export function resolveAccountSelector(selector: string): string {
  return resolveAccountSelectorVerbose(selector).value;
}
