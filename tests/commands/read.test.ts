import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findEmlxByName, runReadUnderRoot, formatRead } from '../../src/commands/read.ts';
import { parseEmlx, type ParsedEmlx } from '../../src/lib/emlx.ts';

function buildEmlx(rfc822: string, flags: number = 0): Buffer {
  const rfc = Buffer.from(rfc822, 'utf-8');
  const xml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>flags</key><integer>${flags}</integer></dict></plist>`,
    'utf-8',
  );
  return Buffer.concat([Buffer.from(`${rfc.length}\n`, 'ascii'), rfc, xml]);
}

describe('findEmlxByName', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'macmail-read-'));
    const deep = join(root, 'V10', 'ACCT', 'INBOX.mbox', 'Data', '0', '1', 'Messages');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, '12345.emlx'), buildEmlx('From: a@b\n\nbody'));
    writeFileSync(join(deep, '99999.emlx'), buildEmlx('From: c@d\n\nbody2'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('finds the requested file in a deep tree', async () => {
    const p = await findEmlxByName(root, '12345.emlx');
    expect(p).not.toBeNull();
    expect(p!.endsWith('/Messages/12345.emlx')).toBe(true);
  });

  test('returns null when missing', async () => {
    expect(await findEmlxByName(root, '00000.emlx')).toBeNull();
  });
});

describe('formatRead', () => {
  function mkParsed(opts: Partial<ParsedEmlx> = {}): ParsedEmlx {
    return {
      id: 1,
      from: 'alice@example.com',
      to: ['bob@example.com'],
      subject: 'Hello',
      date: new Date('2026-05-27T10:00:00Z'),
      messageId: '<abc@example.com>',
      text: 'Body text\n',
      html: '<p>Body html</p>',
      flags: {
        read: false,
        deleted: false,
        answered: false,
        encrypted: false,
        flagged: false,
        recent: false,
        draft: false,
        forwarded: false,
      },
      ...opts,
    };
  }

  test('text mode body only, no trailing duplicate newline', () => {
    expect(formatRead(mkParsed(), { json: false, headers: false, html: false })).toBe(
      'Body text\n',
    );
  });

  test('text mode with --headers prepends From/To/Date/Subject/Message-ID block', () => {
    const out = formatRead(mkParsed(), { json: false, headers: true, html: false });
    expect(out.startsWith('From: alice@example.com\n')).toBe(true);
    expect(out).toContain('Subject: Hello');
    expect(out).toContain('Message-ID: <abc@example.com>');
    expect(out.endsWith('Body text\n')).toBe(true);
  });

  test('--headers shows Date in local time; json date stays UTC', () => {
    const text = formatRead(mkParsed(), { json: false, headers: true, html: false });
    const shown = text.match(/^Date: (.+)$/m)?.[1] ?? '';
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(shown.endsWith('Z')).toBe(false);
    expect(new Date(shown).getTime()).toBe(new Date('2026-05-27T10:00:00Z').getTime());

    const obj = JSON.parse(formatRead(mkParsed(), { json: true, headers: false, html: false }));
    expect(obj.date).toBe('2026-05-27T10:00:00.000Z');
  });

  test('--html returns the HTML body instead of plain text', () => {
    const out = formatRead(mkParsed(), { json: false, headers: false, html: true });
    expect(out).toBe('<p>Body html</p>\n');
  });

  test('json mode emits a single object with full message', () => {
    const out = formatRead(mkParsed(), { json: true, headers: false, html: false });
    const obj = JSON.parse(out);
    expect(obj.id).toBe(1);
    expect(obj.subject).toBe('Hello');
    expect(obj.text).toBe('Body text\n');
    expect(obj.html).toBe('<p>Body html</p>');
    expect(obj.flags.read).toBe(false);
  });
});

describe('runReadUnderRoot integration', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'macmail-read2-'));
    const deep = join(root, 'V10', 'ACCT', 'INBOX.mbox', 'Messages');
    mkdirSync(deep, { recursive: true });
    writeFileSync(
      join(deep, '42.emlx'),
      buildEmlx(
        [
          'From: alice@example.com',
          'To: bob@example.com',
          'Subject: Hi',
          'Date: Wed, 27 May 2026 10:00:00 +0000',
          '',
          'Greetings.',
        ].join('\n'),
        1,
      ),
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('reads body for an existing id', async () => {
    const out = await runReadUnderRoot(42, root, {
      json: false,
      headers: false,
      html: false,
    });
    expect(out).toContain('Greetings.');
  });

  test('with --headers prefixes parsed headers', async () => {
    const out = await runReadUnderRoot(42, root, {
      json: false,
      headers: true,
      html: false,
    });
    expect(out).toContain('From: alice@example.com');
    expect(out).toContain('Subject: Hi');
  });

  test('throws when id is not present', async () => {
    await expect(
      runReadUnderRoot(99999, root, { json: false, headers: false, html: false }),
    ).rejects.toThrow(/not found/);
  });
});
