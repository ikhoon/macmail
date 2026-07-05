// commands/read.ts — fetch a single message body (and optionally headers).

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseEmlx, type ParsedEmlx } from '../lib/emlx.ts';
import { formatDate } from '../lib/output.ts';
import { bold, cyan, dim, green } from '../lib/color.ts';
import { linkifyGitHub } from '../lib/links.ts';
import { EnvelopeIndex } from '../lib/envelope.ts';
import {
  defaultEnvelopeIndexPath,
  findMailVersionDir,
  mailboxUrlToFsPath,
} from '../lib/mail-data.ts';

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
    `${dim('From:')} ${cyan(parsed.from)}`,
    `${dim('To:')} ${parsed.to.join(', ')}`,
    `${dim('Date:')} ${green(parsed.date ? formatDate(parsed.date) : '')}`,
    `${dim('Subject:')} ${bold(linkifyGitHub(parsed.subject))}`,
    `${dim('Message-ID:')} ${dim(parsed.messageId)}`,
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

/**
 * Fast path: resolve the message's storage mailbox via the Envelope Index and
 * walk only that subtree — instead of the whole ~/Library/Mail store. Returns
 * null when the index doesn't know the message or the file isn't on disk (the
 * caller falls back to the full walk).
 */
export async function readViaIndex(
  id: number,
  opts: ReadOptions,
  env: EnvelopeIndex,
  mailVersionDir: string,
): Promise<string | null> {
  const m = env.findMessage(id);
  if (!m) return null;
  const fsRoot = mailboxUrlToFsPath(m.mailboxUrl, mailVersionDir);
  if (!fsRoot) return null;
  const path = await findEmlxByName(fsRoot, `${id}.emlx`);
  if (!path) return null;
  const parsed = await parseEmlx(path, { id });
  return formatRead(parsed, opts);
}

export async function runRead(id: number, opts: ReadOptions): Promise<string> {
  // Try the indexed fast path; any index hiccup (missing DB, stale row, moved
  // file) falls back to the exhaustive walk that always worked.
  try {
    const env = new EnvelopeIndex(defaultEnvelopeIndexPath());
    try {
      const out = await readViaIndex(id, opts, env, findMailVersionDir());
      if (out != null) return out;
    } finally {
      env.close();
    }
  } catch {
    // fall through to the full walk
  }
  return runReadUnderRoot(id, join(homedir(), 'Library', 'Mail'), opts);
}
