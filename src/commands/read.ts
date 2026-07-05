// commands/read.ts — fetch a single message body (and optionally headers).

import { readdir, stat } from 'node:fs/promises';
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
 * Walk `root` recursively looking for a file with one of the given names.
 * Bails out on the first hit so we don't enumerate the entire mail store for
 * one ID.
 */
export async function findEmlxByName(
  root: string,
  target: string | string[],
): Promise<string | null> {
  const targets = new Set(Array.isArray(target) ? target : [target]);
  async function walk(dir: string): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(p);
        if (found) return found;
      } else if (e.isFile() && targets.has(e.name)) {
        return p;
      }
    }
    return null;
  }
  return walk(root);
}

/** The on-disk names a message id can have: fully-downloaded first, then the
 *  partially-downloaded form Mail uses for recent messages. */
export function emlxNamesForId(id: number): string[] {
  return [`${id}.emlx`, `${id}.partial.emlx`];
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
  const path = await findEmlxByName(mailRoot, emlxNamesForId(id));
  if (!path) throw new Error(`message id ${id} not found under ${mailRoot}`);
  const parsed = await parseEmlx(path, { id });
  return formatRead(parsed, opts);
}

const UUID_DIR =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Mail V10 shards message files by id: the shard directories under `Data/`
 *  are the digits of floor(id/1000), most-significant last — e.g. id 2232315
 *  → Data/2/3/2/2/Messages/2232315.emlx, and ids < 1000 sit directly under
 *  Data/Messages/. */
export function shardDirsForId(id: number): string[] {
  const bucket = Math.floor(id / 1000);
  return bucket <= 0 ? [] : String(bucket).split('').reverse();
}

/**
 * Compute the message file's location directly from the V10 layout —
 * `<mbox>/<envelope-uuid>/Data/<shards…>/Messages/<id>.emlx` — instead of
 * walking the subtree. The envelope-UUID directory name isn't derivable, so
 * the mbox dir is listed for UUID-shaped children (there's normally one).
 * Returns null when nothing is at the computed spot (caller falls back).
 */
async function shardedEmlxPath(fsRoot: string, id: number): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(fsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const shards = shardDirsForId(id);
  for (const e of entries) {
    if (!e.isDirectory() || !UUID_DIR.test(e.name)) continue;
    for (const name of emlxNamesForId(id)) {
      const p = join(fsRoot, e.name, 'Data', ...shards, 'Messages', name);
      try {
        await stat(p);
        return p;
      } catch {
        // not at this spot — try the next name / UUID dir
      }
    }
  }
  return null;
}

/**
 * Fast path: resolve the message's storage mailbox via the Envelope Index,
 * then try the sharded path directly (O(1)) and only fall back to walking
 * that mailbox subtree — never the whole ~/Library/Mail store. Returns null
 * when the index doesn't know the message or the file isn't on disk (the
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
  const path =
    (await shardedEmlxPath(fsRoot, id)) ??
    (await findEmlxByName(fsRoot, emlxNamesForId(id)));
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
