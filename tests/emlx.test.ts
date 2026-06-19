import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  splitEmlx,
  parseEmlxFlags,
  flagsFromPlistXml,
  parseEmlx,
  EMPTY_FLAGS,
} from '../src/lib/emlx.ts';

/** Build an .emlx buffer from RFC822 text + a flags integer. Computes the byte
 *  count header correctly so splitEmlx can find the boundary. */
function buildEmlx(rfc822: string, flags: number | null): Buffer {
  const rfc = Buffer.from(rfc822, 'utf-8');
  const xmlStr =
    flags === null
      ? ''
      : `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
<key>flags</key>
<integer>${flags}</integer>
</dict>
</plist>`;
  const xml = Buffer.from(xmlStr, 'utf-8');
  const header = Buffer.from(`${rfc.length}\n`, 'ascii');
  return Buffer.concat([header, rfc, xml]);
}

describe('parseEmlxFlags', () => {
  test('bit 0 = read', () => {
    expect(parseEmlxFlags(1).read).toBe(true);
    expect(parseEmlxFlags(0).read).toBe(false);
  });
  test('bit 2 = answered (replied)', () => {
    expect(parseEmlxFlags(4).answered).toBe(true);
  });
  test('bit 4 = flagged', () => {
    expect(parseEmlxFlags(16).flagged).toBe(true);
  });
  test('composite flag: read + answered', () => {
    const f = parseEmlxFlags(5); // 0b101
    expect(f.read).toBe(true);
    expect(f.answered).toBe(true);
    expect(f.deleted).toBe(false);
  });
});

describe('flagsFromPlistXml', () => {
  test('returns EMPTY_FLAGS when xml is null', () => {
    expect(flagsFromPlistXml(null)).toEqual(EMPTY_FLAGS);
  });
  test('extracts flags integer from Mail.app-style plist', () => {
    const xml = Buffer.from(`<plist><dict><key>flags</key><integer>5</integer></dict></plist>`);
    const f = flagsFromPlistXml(xml);
    expect(f.read).toBe(true);
    expect(f.answered).toBe(true);
  });
  test('returns EMPTY_FLAGS when flags key missing', () => {
    const xml = Buffer.from(`<plist><dict><key>other</key><integer>5</integer></dict></plist>`);
    expect(flagsFromPlistXml(xml)).toEqual(EMPTY_FLAGS);
  });
});

describe('splitEmlx', () => {
  test('splits at the byte-count line', () => {
    const rfc = 'From: a@b\nSubject: Hi\n\nBody';
    const buf = buildEmlx(rfc, 1);
    const { rfc822, plist } = splitEmlx(buf);
    expect(rfc822.toString('utf-8')).toBe(rfc);
    expect(plist).not.toBeNull();
    expect(plist!.toString('utf-8')).toContain('<key>flags</key>');
  });
  test('returns whole buffer as rfc822 when no byte-count line', () => {
    const buf = Buffer.from('From: a@b\nSubject: Hi\n\nBody');
    const { rfc822, plist } = splitEmlx(buf);
    expect(rfc822.toString()).toContain('From: a@b');
    expect(plist).toBeNull();
  });
});

describe('parseEmlx', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'macmail-emlx-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('parses a plain ASCII email + extracts id from filename + flags', async () => {
    const rfc = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Hello',
      'Date: Wed, 27 May 2026 10:00:00 +0000',
      'Message-ID: <abc@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hi Bob, this is a test.',
    ].join('\n');
    const path = join(tmp, '12345.emlx');
    writeFileSync(path, buildEmlx(rfc, 1)); // flags=1 → read
    const p = await parseEmlx(path);
    expect(p.id).toBe(12345);
    expect(p.from).toContain('alice@example.com');
    expect(p.to).toEqual(['bob@example.com']);
    expect(p.subject).toBe('Hello');
    expect(p.messageId).toBe('<abc@example.com>');
    expect(p.text).toContain('Hi Bob');
    expect(p.flags.read).toBe(true);
  });

  test('decodes Korean MIME-encoded subject (=?UTF-8?B?...?=)', async () => {
    // "초대장" base64-encoded under UTF-8
    const encoded = Buffer.from('초대장', 'utf-8').toString('base64');
    const rfc = [
      'From: alice@example.com',
      'To: bob@example.com',
      `Subject: =?UTF-8?B?${encoded}?=`,
      'Date: Wed, 27 May 2026 10:00:00 +0000',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'invitation',
    ].join('\n');
    const path = join(tmp, '67890.emlx');
    writeFileSync(path, buildEmlx(rfc, 0));
    const p = await parseEmlx(path);
    expect(p.subject).toBe('초대장');
    expect(p.flags.read).toBe(false);
  });

  test('handles email with no trailing plist (flags default to all false)', async () => {
    const rfc = [
      'From: alice@example.com',
      'Subject: No flags',
      'Date: Wed, 27 May 2026 10:00:00 +0000',
      '',
      'Body',
    ].join('\n');
    const path = join(tmp, '99999.emlx');
    writeFileSync(path, buildEmlx(rfc, null));
    const p = await parseEmlx(path);
    expect(p.flags).toEqual(EMPTY_FLAGS);
  });
});
