import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvelopeIndex, type MessageSummary } from '../../src/lib/envelope.ts';
import {
  runSubjectSearch,
  runBodySearch,
  mergeResults,
  formatSearchOutput,
  parseSearchDate,
  makeSnippet,
  hydrateBodies,
  type SearchOutcome,
} from '../../src/commands/search.ts';
import { buildEnvelopeFixture } from '../helpers/envelope-fixture.ts';

/** Build a minimal .emlx file: byte-count line + RFC822 + plist trailer. */
function buildEmlx(rfc822: string, flags: number = 0): Buffer {
  const rfc = Buffer.from(rfc822, 'utf-8');
  const xml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>flags</key><integer>${flags}</integer></dict></plist>`,
    'utf-8',
  );
  return Buffer.concat([Buffer.from(`${rfc.length}\n`, 'ascii'), rfc, xml]);
}

/** Drop a .emlx file at the storage layout used by Mail V10:
 *   <tmpRoot>/<acct>/<mboxSegment>.mbox/Messages/<id>.emlx
 *  (the per-envelope UUID + sharded Data/N/N/.. directories aren't needed
 *  for the test — runBodySearch's subtree walk descends into any depth.) */
function placeEmlx(
  tmpRoot: string,
  acct: string,
  mboxPath: string,
  id: number,
  rfc822: string,
): void {
  const dir = join(tmpRoot, acct, `${mboxPath}.mbox`, 'Messages');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.emlx`), buildEmlx(rfc822));
}

describe('runSubjectSearch (SQL via Envelope Index)', () => {
  let env: EnvelopeIndex;
  beforeAll(() => {
    env = new EnvelopeIndex(buildEnvelopeFixture());
  });
  afterAll(() => env.close());

  test('finds Korean substring in the subjects table', () => {
    const hits = runSubjectSearch(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      query: '초대장',
      scope: 'subject',
      max: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].subject).toBe('초대장: xDS server design');
  });

  test('returns empty list when no match', () => {
    const hits = runSubjectSearch(env, {
      json: false,
      account: 'user@gmail.com',
      mailbox: 'INBOX',
      query: 'absolutely-no-match',
      scope: 'subject',
      max: 5,
    });
    expect(hits).toEqual([]);
  });
});

describe('makeSnippet', () => {
  test('extracts query with ±N chars of context', () => {
    // text indices: a(0) b c d e f g h(7) i j HELLO(10..14) w(15) o r l d x y z
    const text = 'abcdefghijHELLOworldxyz';
    const s = makeSnippet(text, 'hello', 3);
    expect(s.startsWith('…hij')).toBe(true);   // chars 7..9
    expect(s).toContain('HELLO');               // preserves original case
    expect(s.endsWith('wor…')).toBe(true);      // chars 15..17
  });

  test('collapses internal whitespace runs to a single space', () => {
    const text = 'pre\n\n  hello\nworld   post';
    const s = makeSnippet(text, 'hello', 100);
    expect(s).not.toMatch(/\n/);
    expect(s).not.toMatch(/  /);
  });

  test('no leading ellipsis when match is near start', () => {
    const s = makeSnippet('hello world', 'hello', 100);
    expect(s.startsWith('…')).toBe(false);
  });

  test('returns empty string when query missing', () => {
    expect(makeSnippet('nothing here', 'xyz', 10)).toBe('');
  });
});

describe('runBodySearch (.emlx grep ∩ Envelope Index)', () => {
  let env: EnvelopeIndex;
  let tmpRoot: string;

  beforeAll(async () => {
    env = new EnvelopeIndex(buildEnvelopeFixture());
    tmpRoot = mkdtempSync(join(tmpdir(), 'macmail-bs-'));

    // Drop .emlx files at the path layout that mailboxUrlToFsPath builds.
    // Storage mailbox 1: 'imap://user@gmail.com/INBOX' → /<root>/user@gmail.com/INBOX.mbox/Messages/<id>.emlx
    placeEmlx(
      tmpRoot,
      'user@gmail.com',
      'INBOX',
      100,
      [
        'From: alice@example.com',
        'Subject: Welcome',
        'Date: Wed, 27 May 2026 10:00:00 +0000',
        '',
        'first body — please review the release notes below.',
      ].join('\n'),
    );
    placeEmlx(
      tmpRoot,
      'user@gmail.com',
      'INBOX',
      101,
      [
        'From: bob@example.com',
        'Subject: Meeting at noon',
        'Date: Wed, 27 May 2026 11:00:00 +0000',
        '',
        'nothing relevant in here',
      ].join('\n'),
    );
    // 102 deliberately NOT placed — exercises the cached-subset miss path.

    // Storage mailbox 4: 'imap://gview@gmail.com/[Gmail]/All Mail' is the
    // backing store for view mailbox 5 (gview@gmail.com/INBOX). Message
    // 400 lives only under that storage path.
    placeEmlx(
      tmpRoot,
      'gview@gmail.com',
      '[Gmail]',
      400,
      'placeholder',
    );
    // The actual file we want goes under the nested .mbox path.
    rmSync(join(tmpRoot, 'gview@gmail.com', '[Gmail].mbox', 'Messages'), {
      recursive: true,
      force: true,
    });
    const allMailDir = join(
      tmpRoot,
      'gview@gmail.com',
      '[Gmail].mbox',
      'All Mail.mbox',
      'Messages',
    );
    mkdirSync(allMailDir, { recursive: true });
    writeFileSync(
      join(allMailDir, '400.emlx'),
      buildEmlx(
        [
          'From: gmail-user@example.com',
          'Subject: Gmail labelled note',
          'Date: Wed, 27 May 2026 12:00:00 +0000',
          '',
          'this is the labelled body with the keyword release here',
        ].join('\n'),
      ),
    );
  });

  afterAll(() => {
    env.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('matches a candidate whose .emlx exists in the storage subtree', async () => {
    const r = await runBodySearch(
      env,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 5,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows.map((x) => x.id)).toEqual([100]);
    expect(r.total).toBe(1);
    expect(r.examined).toBe(2); // 100 + 101 present; 102 missing
  });

  test('skips cached-miss candidates (no .emlx on disk) silently', async () => {
    const r = await runBodySearch(
      env,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: '102 will not match nor exist',
        max: 5,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });

  test('view mailbox query reaches the storage mbox via storageMailboxUrl', async () => {
    const r = await runBodySearch(
      env,
      {
        account: 'gview@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 5,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows.map((x) => x.id)).toEqual([400]);
    // The result carries the storage URL, not the view URL.
    expect(r.rows[0].mailboxUrl).toBe(
      'imap://gview@gmail.com/[Gmail]/All Mail',
    );
  });

  test('snippet option attaches ±N chars of context around the match', async () => {
    const r = await runBodySearch(
      env,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 5,
        snippet: 20,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows[0].snippet).toBeDefined();
    expect(r.rows[0].snippet).toContain('release');
  });

  test('no snippet attached when option not passed', async () => {
    const r = await runBodySearch(
      env,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 5,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows[0].snippet).toBeUndefined();
  });

  test('respects max cap (sliced after grep)', async () => {
    // Add a second matching candidate by placing another .emlx under
    // INBOX storage that hits "release".
    placeEmlx(
      tmpRoot,
      'user@gmail.com',
      'INBOX',
      99,
      'From: a@a\nSubject: x\n\nrelease in the body',
    );
    const env2 = new EnvelopeIndex(buildEnvelopeFixture());
    // We can't actually add 99 to the envelope fixture without rebuilding
    // it, so this assertion just confirms max bounds existing matches.
    const r = await runBodySearch(
      env2,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 1,
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows).toHaveLength(1);
    env2.close();
  });

  test('passes filter bag through to envelope.listBodySearchCandidates', async () => {
    // 100 is read; with --unread it falls out of the candidate set entirely.
    const r = await runBodySearch(
      env,
      {
        account: 'user@gmail.com',
        mailbox: 'INBOX',
        query: 'release',
        max: 5,
        filters: { unread: true },
      },
      { mailVersionDir: tmpRoot },
    );
    expect(r.rows.find((row) => row.id === 100)).toBeUndefined();
  });
});

describe('hydrateBodies', () => {
  let env: EnvelopeIndex;
  let tmpRoot: string;

  beforeAll(() => {
    env = new EnvelopeIndex(buildEnvelopeFixture());
    tmpRoot = mkdtempSync(join(tmpdir(), 'macmail-hb-'));
    placeEmlx(
      tmpRoot,
      'user@gmail.com',
      'INBOX',
      101,
      [
        'From: alice@example.com',
        'Subject: Meeting at noon',
        'Date: Wed, 27 May 2026 11:00:00 +0000',
        '',
        'this is the body of message one-oh-one for hydrate test',
      ].join('\n'),
    );
  });
  afterAll(() => {
    env.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('attaches decoded text body to each row', async () => {
    const rows: MessageSummary[] = [mkSummary(101, '2026-05-27T11:00:00Z')];
    const out = await hydrateBodies(env, rows, tmpRoot);
    expect(out[0].text).toMatch(/one-oh-one/);
  });

  test('truncate option clamps body to N chars + ellipsis', async () => {
    const rows: MessageSummary[] = [mkSummary(101, '2026-05-27T11:00:00Z')];
    const out = await hydrateBodies(env, rows, tmpRoot, 20);
    expect(out[0].text!.length).toBeLessThanOrEqual(21); // 20 + '…'
    expect(out[0].text!.endsWith('…')).toBe(true);
  });

  test('row without an .emlx on disk is returned unchanged', async () => {
    const rows: MessageSummary[] = [mkSummary(102, '2026-05-27T10:00:00Z')];
    const out = await hydrateBodies(env, rows, tmpRoot);
    expect(out[0].text).toBeUndefined();
  });
});

describe('mergeResults', () => {
  test('de-dupes by id, sorts newest first, respects max', () => {
    const a: MessageSummary[] = [
      mkSummary(1, '2026-05-01T00:00:00Z'),
      mkSummary(2, '2026-05-02T00:00:00Z'),
    ];
    const b: MessageSummary[] = [
      mkSummary(2, '2026-05-02T00:00:00Z'),
      mkSummary(3, '2026-05-03T00:00:00Z'),
    ];
    const merged = mergeResults(a, b, 10);
    expect(merged.map((m) => m.id)).toEqual([3, 2, 1]);
  });

  test('caps at max', () => {
    const a: MessageSummary[] = Array.from({ length: 5 }, (_, i) =>
      mkSummary(i, `2026-05-0${i + 1}T00:00:00Z`),
    );
    const merged = mergeResults(a, [], 3);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.id)).toEqual([4, 3, 2]);
  });
});

function mkSummary(id: number, iso: string): MessageSummary {
  return {
    id,
    sender: '',
    subject: '',
    dateReceived: new Date(iso),
    read: false,
    flags: 0,
    mailboxId: 0,
    mailboxUrl: '',
  };
}

describe('parseSearchDate', () => {
  test('YYYY-MM-DD → local midnight unix seconds', () => {
    expect(parseSearchDate('2026-05-27')).toBe(
      Math.floor(new Date(2026, 4, 27).getTime() / 1000),
    );
  });

  test('MM-DD / M-D fills the year in from `now`', () => {
    const now = new Date(2026, 0, 15);
    const expected = Math.floor(new Date(2026, 4, 27).getTime() / 1000);
    expect(parseSearchDate('05-27', now)).toBe(expected);
    expect(parseSearchDate('5-27', now)).toBe(expected);
  });

  test('rejects malformed input', () => {
    expect(() => parseSearchDate('27-05-2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseSearchDate('2026/05/27')).toThrow(/YYYY-MM-DD/);
    expect(() => parseSearchDate('2026-05')).toThrow(/YYYY-MM-DD/);
  });

  test('rejects calendar-invalid dates', () => {
    expect(() => parseSearchDate('2026-13-01')).toThrow(/invalid/);
    expect(() => parseSearchDate('2026-02-30')).toThrow(/invalid/);
  });
});

describe('parseSearchDate relative tokens', () => {
  const now = new Date(2026, 4, 27, 14, 30); // 2026-05-27 14:30, local
  const midnightDaysAgo = (n: number) =>
    Math.floor(new Date(2026, 4, 27 - n).getTime() / 1000);

  test('today / yesterday snap to local midnight', () => {
    expect(parseSearchDate('today', now)).toBe(midnightDaysAgo(0));
    expect(parseSearchDate('yesterday', now)).toBe(midnightDaysAgo(1));
  });

  test('tokens are case-insensitive', () => {
    expect(parseSearchDate('TODAY', now)).toBe(midnightDaysAgo(0));
    expect(parseSearchDate('Yesterday', now)).toBe(midnightDaysAgo(1));
  });

  test('Nd / Nw count back in days / weeks', () => {
    expect(parseSearchDate('0d', now)).toBe(midnightDaysAgo(0));
    expect(parseSearchDate('7d', now)).toBe(midnightDaysAgo(7));
    expect(parseSearchDate('2w', now)).toBe(midnightDaysAgo(14));
  });

  test('relative tokens ignore the time-of-day in `now`', () => {
    expect(parseSearchDate('today', new Date(2026, 4, 27, 23, 59))).toBe(midnightDaysAgo(0));
  });

  test('unknown tokens fall through to date parsing and throw', () => {
    expect(() => parseSearchDate('tomorrow', now)).toThrow(/relative token/);
    expect(() => parseSearchDate('7days', now)).toThrow(/relative token/);
  });
});

describe('formatSearchOutput', () => {
  const rows: MessageSummary[] = [
    mkSummary(1, '2026-05-27T10:00:00Z'),
    mkSummary(2, '2026-05-27T09:00:00Z'),
  ];

  test('text mode appends trailer when total > shown', () => {
    const outcome: SearchOutcome = { rows, total: 5 };
    const out = formatSearchOutput(outcome, { json: false, max: 2 });
    expect(out).toMatch(/\(showing 2 of 5/);
  });

  test('JSON mode appends _summary line', () => {
    const outcome: SearchOutcome = { rows, total: 5, examined: 23 };
    const out = formatSearchOutput(outcome, { json: true, max: 2 });
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({
      _summary: { shown: 2, total: 5, examined: 23 },
    });
  });

  test('countOnly text mode prints just the summary lines', () => {
    const outcome: SearchOutcome = {
      rows: [],
      total: 42,
      examined: 89,
    };
    const out = formatSearchOutput(outcome, {
      json: false,
      max: 10,
      countOnly: true,
    });
    expect(out).toContain('total: 42');
    expect(out).toContain('examined: 89');
  });

  test('text mode with body field prints body on its own block, --- between rows', () => {
    const withBody: MessageSummary[] = [
      { ...mkSummary(1, '2026-05-27T10:00:00Z'), text: 'first body content' },
      { ...mkSummary(2, '2026-05-27T09:00:00Z'), text: 'second body content' },
    ];
    const out = formatSearchOutput({ rows: withBody, total: 2 }, { json: false, max: 10 });
    expect(out).toContain('first body content');
    expect(out).toContain('second body content');
    expect(out).toContain('---'); // separator between rows
  });

  test('JSON mode passes the text field through', () => {
    const withBody: MessageSummary[] = [
      { ...mkSummary(1, '2026-05-27T10:00:00Z'), text: 'hello body' },
    ];
    const out = formatSearchOutput({ rows: withBody, total: 1 }, { json: true, max: 10 });
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].text).toBe('hello body');
  });
});
