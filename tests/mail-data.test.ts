import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listMailAccountUuids,
  readAccountEnrichments,
  listAccountsFromSources,
  resolveAccountUuid,
  mailboxUrlToFsPath,
  accountIdFromMailboxUrl,
  type Account,
} from '../src/lib/mail-data.ts';

const UUID_GMAIL = 'A4E92B36-90A1-4BA5-AD06-2A5E6179D603';
const UUID_WORK  = 'DC1EB047-9021-45D6-A252-50FF783B0335';
const UUID_LOCAL = '7DDA5222-2321-466C-897F-E7B80F097675';

/** Build an Accounts4-compatible SQLite file at `path`, populated with the
 * child→parent rows that match the UUIDs above. */
function buildAccountsFixture(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ZACCOUNTTYPE (
      Z_PK INTEGER PRIMARY KEY,
      ZACCOUNTTYPEDESCRIPTION TEXT
    );
    CREATE TABLE ZACCOUNT (
      Z_PK INTEGER PRIMARY KEY,
      ZIDENTIFIER TEXT,
      ZUSERNAME TEXT,
      ZACCOUNTDESCRIPTION TEXT,
      ZACCOUNTTYPE INTEGER,
      ZPARENTACCOUNT INTEGER
    );

    INSERT INTO ZACCOUNTTYPE (Z_PK, ZACCOUNTTYPEDESCRIPTION) VALUES
      (10, 'Gmail'),
      (20, 'IMAPMail'),
      (30, 'On My Device');

    -- Parents
    INSERT INTO ZACCOUNT (Z_PK, ZIDENTIFIER, ZUSERNAME, ZACCOUNTDESCRIPTION, ZACCOUNTTYPE, ZPARENTACCOUNT) VALUES
      (100, '00000000-0000-0000-0000-000000000100', 'personal@example.com',     'Personal',  10, NULL),
      (101, '00000000-0000-0000-0000-000000000101', 'user@example.com',     'Work',      10, NULL);

    -- Mail children (these are the UUIDs that appear under ~/Library/Mail/V10/)
    INSERT INTO ZACCOUNT (Z_PK, ZIDENTIFIER, ZUSERNAME, ZACCOUNTDESCRIPTION, ZACCOUNTTYPE, ZPARENTACCOUNT) VALUES
      (200, '${UUID_GMAIL}', NULL, NULL,        20, 100),
      (201, '${UUID_WORK}',  NULL, NULL,        20, 101),
      -- Local "On My Mac" has no parent and carries its own description.
      (202, '${UUID_LOCAL}', NULL, 'On My Mac', 30, NULL);
  `);
  db.close();
}

describe('listMailAccountUuids', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'macmail-maildir-'));
    mkdirSync(join(dir, UUID_GMAIL));
    mkdirSync(join(dir, UUID_WORK));
    mkdirSync(join(dir, 'MailData'));            // non-UUID — should be ignored
    writeFileSync(join(dir, '.DS_Store'), '');    // file — should be ignored
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('returns only UUID-shaped subdirectories', () => {
    const ids = listMailAccountUuids(dir);
    expect(ids.sort()).toEqual([UUID_GMAIL, UUID_WORK].sort());
  });

  test('returns empty array when directory is missing', () => {
    expect(listMailAccountUuids('/nonexistent/path')).toEqual([]);
  });
});

describe('readAccountEnrichments', () => {
  let dbPath: string;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'macmail-accts4-'));
    dbPath = join(dir, 'Accounts4.sqlite');
    buildAccountsFixture(dbPath);
  });

  test('joins child to parent for description/email/type', () => {
    const map = readAccountEnrichments(dbPath, [UUID_GMAIL, UUID_WORK]);
    expect(map.get(UUID_GMAIL)).toEqual({
      description: 'Personal',
      email: 'personal@example.com',
      type: 'Gmail',
    });
    expect(map.get(UUID_WORK)).toEqual({
      description: 'Work',
      email: 'user@example.com',
      type: 'Gmail',
    });
  });

  test('falls back to child fields when no parent exists', () => {
    const map = readAccountEnrichments(dbPath, [UUID_LOCAL]);
    expect(map.get(UUID_LOCAL)).toEqual({
      description: 'On My Mac',
      email: null,
      type: 'On My Device',
    });
  });

  test('returns empty map when no UUIDs requested', () => {
    expect(readAccountEnrichments(dbPath, []).size).toBe(0);
  });
});

describe('listAccountsFromSources', () => {
  let mailDir: string;
  let dbPath: string;
  beforeAll(() => {
    mailDir = mkdtempSync(join(tmpdir(), 'macmail-mail-'));
    mkdirSync(join(mailDir, UUID_GMAIL));
    mkdirSync(join(mailDir, UUID_WORK));
    mkdirSync(join(mailDir, UUID_LOCAL));
    const dbDir = mkdtempSync(join(tmpdir(), 'macmail-accts4-'));
    dbPath = join(dbDir, 'Accounts4.sqlite');
    buildAccountsFixture(dbPath);
  });

  test('returns enriched accounts when Accounts4.sqlite is available', () => {
    const accts = listAccountsFromSources(mailDir, dbPath);
    expect(accts).toHaveLength(3);
    const byUuid = new Map(accts.map((a) => [a.uuid, a]));
    expect(byUuid.get(UUID_GMAIL)).toEqual({
      uuid: UUID_GMAIL,
      name: 'Personal',
      email: 'personal@example.com',
      type: 'Gmail',
    });
    expect(byUuid.get(UUID_WORK)?.name).toBe('Work');
    expect(byUuid.get(UUID_LOCAL)).toEqual({
      uuid: UUID_LOCAL,
      name: 'On My Mac',
      email: null,
      type: 'On My Device',
    });
  });

  test('falls back to UUID-only entries when Accounts4 path is null', () => {
    const accts = listAccountsFromSources(mailDir, null);
    expect(accts.map((a) => a.name).sort()).toEqual(
      [UUID_GMAIL, UUID_WORK, UUID_LOCAL].sort(),
    );
    expect(accts.every((a) => a.type === 'Unknown')).toBe(true);
    expect(accts.every((a) => a.email === null)).toBe(true);
  });

  test('falls back to UUID-only entries when Accounts4 path does not exist', () => {
    const accts = listAccountsFromSources(mailDir, '/nonexistent/Accounts4.sqlite');
    expect(accts).toHaveLength(3);
    expect(accts.every((a) => a.type === 'Unknown')).toBe(true);
  });
});

describe('resolveAccountUuid', () => {
  const accounts: Account[] = [
    { uuid: UUID_GMAIL, name: 'Personal', email: 'personal@example.com',     type: 'Gmail' },
    { uuid: UUID_WORK,  name: 'Work',     email: 'user@example.com',      type: 'Gmail' },
    { uuid: UUID_LOCAL, name: 'On My Mac', email: null,                   type: 'On My Device' },
  ];

  test('matches a UUID case-insensitively', () => {
    expect(resolveAccountUuid(UUID_WORK.toLowerCase(), accounts)).toBe(UUID_WORK);
  });

  test('matches a description exactly (case-insensitive)', () => {
    expect(resolveAccountUuid('WORK', accounts)).toBe(UUID_WORK);
    expect(resolveAccountUuid('personal', accounts)).toBe(UUID_GMAIL);
  });

  test('matches an email exactly', () => {
    expect(resolveAccountUuid('user@example.com', accounts)).toBe(UUID_WORK);
  });

  test('matches a substring as a last resort', () => {
    expect(resolveAccountUuid('user@', accounts)).toBe(UUID_WORK);
  });

  test('returns null when nothing matches', () => {
    expect(resolveAccountUuid('no-such-account', accounts)).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(resolveAccountUuid('', accounts)).toBeNull();
  });
});

describe('mailboxUrlToFsPath', () => {
  const ROOT = '/tmp/mail/V10';
  const UUID = 'DC1EB047-9021-45D6-A252-50FF783B0335';

  test('simple top-level mailbox', () => {
    expect(mailboxUrlToFsPath(`imap://${UUID}/INBOX`, ROOT)).toBe(
      `${ROOT}/${UUID}/INBOX.mbox`,
    );
  });

  test('nested mailbox — each segment becomes a .mbox dir', () => {
    expect(
      mailboxUrlToFsPath(`imap://${UUID}/[Gmail]/All%20Mail`, ROOT),
    ).toBe(`${ROOT}/${UUID}/[Gmail].mbox/All Mail.mbox`);
  });

  test('URL-encoded Korean segments round-trip', () => {
    // %E1%84%8C%E1%85%A5%E1%86%AB%E1%84%8E%E1%85%A6%E1%84%87%E1%85%A9%E1%84%80%E1%85%AA%E1%86%AB%E1%84%92%E1%85%A1%E1%86%B7 == "전체보관함"
    const encoded = `imap://${UUID}/%5BGmail%5D/%E1%84%8C%E1%85%A5%E1%86%AB%E1%84%8E%E1%85%A6%E1%84%87%E1%85%A9%E1%84%80%E1%85%AA%E1%86%AB%E1%84%92%E1%85%A1%E1%86%B7`;
    // The URL bytes are NFD-decomposed (Apple's APFS legacy form). Comparing
    // against an NFC literal would mis-match identical-looking characters,
    // so we normalize the expected string to NFD too.
    expect(mailboxUrlToFsPath(encoded, ROOT)).toBe(
      `${ROOT}/${UUID}/[Gmail].mbox/전체보관함.mbox`.normalize('NFD'),
    );
  });

  test('local:// scheme works the same way', () => {
    expect(mailboxUrlToFsPath(`local://${UUID}/Drafts`, ROOT)).toBe(
      `${ROOT}/${UUID}/Drafts.mbox`,
    );
  });

  test('returns null for empty mailbox path', () => {
    expect(mailboxUrlToFsPath(`imap://${UUID}/`, ROOT)).toBeNull();
    expect(mailboxUrlToFsPath(`imap://${UUID}`, ROOT)).toBeNull();
  });

  test('returns null for unsupported / malformed URLs', () => {
    expect(mailboxUrlToFsPath('http://example.com/foo', ROOT)).toBeNull();
    expect(mailboxUrlToFsPath('not-a-url', ROOT)).toBeNull();
    expect(mailboxUrlToFsPath('', ROOT)).toBeNull();
  });

  test('rejects percent-encoded path traversal segments', () => {
    expect(mailboxUrlToFsPath(`imap://${UUID}/%2e%2e`, ROOT)).toBeNull();
    expect(mailboxUrlToFsPath(`imap://${UUID}/%2e%2e%2f%2e%2e%2fsecret`, ROOT)).toBeNull();
  });
});

describe('accountIdFromMailboxUrl', () => {
  test('extracts a UUID authority from a real Mail URL', () => {
    expect(
      accountIdFromMailboxUrl(`imap://${UUID_WORK}/INBOX`),
    ).toBe(UUID_WORK);
  });

  test('extracts an email-style authority (fixtures)', () => {
    expect(accountIdFromMailboxUrl('imap://user@gmail.com/INBOX')).toBe(
      'user@gmail.com',
    );
  });

  test('ignores the path, returns only the authority', () => {
    expect(
      accountIdFromMailboxUrl(`local://${UUID_LOCAL}/[Gmail]/All Mail`),
    ).toBe(UUID_LOCAL);
  });

  test('returns null when there is no authority', () => {
    expect(accountIdFromMailboxUrl('not-a-url')).toBeNull();
    expect(accountIdFromMailboxUrl('')).toBeNull();
  });
});
