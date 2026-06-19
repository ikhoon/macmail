// commands/read.ts — fetch a single message body (and optionally headers).

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseEmlx, type ParsedEmlx } from '../lib/emlx.ts';
import { toLocalISO } from '../lib/output.ts';

export interface ReadOptions {
  json: boolean;
  headers: boolean;
  html: boolean;
}

/**
 * Walk `root` recursively looking for a file named `<id>.emlx`. Bails out
 * on the first hit so we don't enumerate the entire mail store for one ID.
 */
export async function findEmlxByName(root: string, target: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      const found = await findEmlxByName(p, target);
      if (found) return found;
    } else if (e.isFile() && e.name === target) {
      return p;
    }
  }
  return null;
}

export function formatHeaders(parsed: ParsedEmlx): string {
  return [
    `From: ${parsed.from}`,
    `To: ${parsed.to.join(', ')}`,
    `Date: ${parsed.date ? toLocalISO(parsed.date) : ''}`,
    `Subject: ${parsed.subject}`,
    `Message-ID: ${parsed.messageId}`,
    '',
    '',
  ].join('\n');
}

export function formatRead(parsed: ParsedEmlx, opts: ReadOptions): string {
  if (opts.json) {
    return (
      JSON.stringify({
        id: parsed.id,
        from: parsed.from,
        to: parsed.to,
        subject: parsed.subject,
        date: parsed.date?.toISOString() ?? null,
        messageId: parsed.messageId,
        flags: parsed.flags,
        text: parsed.text ?? null,
        html: parsed.html ?? null,
      }) + '\n'
    );
  }
  const body = opts.html ? (parsed.html ?? '') : (parsed.text ?? '');
  const head = opts.headers ? formatHeaders(parsed) : '';
  const trailing = body.endsWith('\n') ? '' : '\n';
  return head + body + trailing;
}

export async function runReadUnderRoot(
  id: number,
  mailRoot: string,
  opts: ReadOptions,
): Promise<string> {
  const path = await findEmlxByName(mailRoot, `${id}.emlx`);
  if (!path) throw new Error(`message id ${id} not found under ${mailRoot}`);
  const parsed = await parseEmlx(path, { id });
  return formatRead(parsed, opts);
}

export async function runRead(id: number, opts: ReadOptions): Promise<string> {
  return runReadUnderRoot(id, join(homedir(), 'Library', 'Mail'), opts);
}
