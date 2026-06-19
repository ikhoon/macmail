// emlx.ts — parse Mail.app .emlx files.
//
// .emlx layout:
//   <byte-count>\n
//   <byte-count bytes of RFC822 message>
//   <Apple plist (XML) holding flags, conversation_id, etc.>
//
// We split on the first newline (byte count), parse the RFC822 chunk with
// `mailparser` (handles MIME headers + body encoding + Korean correctly), and
// extract the `flags` integer from the trailing XML plist via a small regex.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';

export interface EmlxFlags {
  read: boolean;
  deleted: boolean;
  answered: boolean;
  encrypted: boolean;
  flagged: boolean;
  recent: boolean;
  draft: boolean;
  forwarded: boolean;
}

export const EMPTY_FLAGS: EmlxFlags = {
  read: false,
  deleted: false,
  answered: false,
  encrypted: false,
  flagged: false,
  recent: false,
  draft: false,
  forwarded: false,
};

export interface ParsedEmlx {
  /** Mail.app integer ID (taken from the filename: `<id>.emlx`). */
  id: number;
  from: string;
  to: string[];
  subject: string;
  date: Date | null;
  messageId: string;
  text?: string;
  html?: string;
  flags: EmlxFlags;
}

/**
 * Split a raw `.emlx` buffer into its RFC822 message and trailing plist parts.
 * If the first line isn't a numeric byte count (older format / corrupted), we
 * fall back to treating the whole file as RFC822 with no plist.
 */
export function splitEmlx(buf: Buffer): { rfc822: Buffer; plist: Buffer | null } {
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return { rfc822: buf, plist: null };
  const countStr = buf.subarray(0, nl).toString('ascii').trim();
  const count = Number.parseInt(countStr, 10);
  if (!Number.isFinite(count) || count < 0 || count > buf.length - nl - 1) {
    return { rfc822: buf, plist: null };
  }
  const rfc822 = buf.subarray(nl + 1, nl + 1 + count);
  const plist = buf.subarray(nl + 1 + count);
  return { rfc822, plist: plist.length > 0 ? plist : null };
}

/** Decode Mail.app's flags bitmask. Bit positions per Apple's documented order. */
export function parseEmlxFlags(n: number): EmlxFlags {
  return {
    read:      (n & (1 << 0)) !== 0,
    deleted:   (n & (1 << 1)) !== 0,
    answered:  (n & (1 << 2)) !== 0,
    encrypted: (n & (1 << 3)) !== 0,
    flagged:   (n & (1 << 4)) !== 0,
    recent:    (n & (1 << 5)) !== 0,
    draft:     (n & (1 << 6)) !== 0,
    forwarded: (n & (1 << 7)) !== 0,
  };
}

/** Extract `<key>flags</key><integer>N</integer>` from the trailing XML plist. */
export function flagsFromPlistXml(xml: Buffer | null): EmlxFlags {
  if (!xml || xml.length === 0) return EMPTY_FLAGS;
  const text = xml.toString('utf-8');
  const m = text.match(/<key>flags<\/key>\s*<integer>(-?\d+)<\/integer>/);
  if (!m) return EMPTY_FLAGS;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n)) return EMPTY_FLAGS;
  return parseEmlxFlags(n);
}

function addressTexts(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap((a) => a.value.map((v) => (v.name ? `${v.name} <${v.address}>` : v.address ?? '')));
}

export async function parseEmlx(path: string, opts?: { id?: number }): Promise<ParsedEmlx> {
  const buf = await readFile(path);
  const { rfc822, plist } = splitEmlx(buf);
  const parsed: ParsedMail = await simpleParser(rfc822);
  const idFromName = Number.parseInt(basename(path, '.emlx'), 10);
  const id = opts?.id ?? (Number.isFinite(idFromName) ? idFromName : 0);
  return {
    id,
    from: parsed.from?.text ?? '',
    to: addressTexts(parsed.to),
    subject: parsed.subject ?? '',
    date: parsed.date ?? null,
    messageId: parsed.messageId ?? '',
    text: parsed.text || undefined,
    html: typeof parsed.html === 'string' ? parsed.html : undefined,
    flags: flagsFromPlistXml(plist),
  };
}
