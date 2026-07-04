// commands/search.ts — keyword search.
//
// - Subject path: SQL `LIKE` over the Envelope Index, plus the structured
//   filter bag (sender/recipient/date range/unread/flagged). Fast, no
//   external dependencies.
// - Body path: Envelope Index narrows the candidate message IDs (mailbox,
//   labels, filter bag, date range). For each candidate we look up the
//   `.emlx` under the storage mailbox's on-disk subtree and read it via
//   mailparser to grep the decoded text body. Messages whose `.emlx`
//   hasn't been cached locally by Mail.app are silently skipped (CLI
//   can't fetch from the IMAP server). View mailboxes (Gmail-style INBOX)
//   resolve to the correct storage path automatically because the candidate
//   carries the storage URL, not the view URL.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BodySearchCandidate,
  EnvelopeFilters,
  EnvelopeIndex,
  MessageSummary,
} from '../lib/envelope.ts';
import { EnvelopeIndex as EI } from '../lib/envelope.ts';
import {
  defaultEnvelopeIndexPath,
  findMailVersionDir,
  mailboxUrlToFsPath,
} from '../lib/mail-data.ts';
import { formatRecords } from '../lib/output.ts';
import { bold, cyan, dim, green, yellow } from '../lib/color.ts';
import { linkifyGitHub } from '../lib/links.ts';
import { buildMailboxUrlPattern } from './triage.ts';
import { parseEmlx } from '../lib/emlx.ts';

export type SearchScope = 'subject' | 'body' | 'both';

export interface SearchOptions {
  json: boolean;
  account: string;
  mailbox: string;
  query?: string;
  scope: SearchScope;
  max: number;
  /** Structured filters; `--days` is folded into `filters.sinceUnixSec` by
   *  the CLI before reaching this layer. */
  filters?: EnvelopeFilters;
  countOnly?: boolean;
  /** When >0, attach a body excerpt of ±N chars around the match. */
  snippet?: number;
  /** When set, attach the full (or truncated) decoded text body to each row.
   *  undefined = off, 0 = full, N>0 = truncate to N chars + '…'. */
  body?: number;
}

export interface RunBodySearchDeps {
  /** Base for `~/Library/Mail/V<N>/` lookup; overridable in tests. */
  mailVersionDir?: string;
}

export interface BodySearchResult {
  /** Survivors of the grep, post-sort, post-max slice. */
  rows: MessageSummary[];
  /** Distinct intersect count before `max` slicing. */
  total: number;
  /** How many `.emlx` files we actually read (cached-subset size touched). */
  examined: number;
}

export interface SearchOutcome {
  rows: MessageSummary[];
  total: number;
  /** How many `.emlx` were read on the body path. Absent for subject-only. */
  examined?: number;
}

function formatRows(msgs: MessageSummary[], json: boolean): string {
  if (json) {
    return formatRecords(
      msgs.map((m) => {
        const base: Record<string, unknown> = {
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          date: m.dateReceived,
        };
        if (m.snippet) base.snippet = m.snippet;
        if (m.text != null) base.text = m.text;
        return base;
      }),
      { json: true },
    );
  }
  // Text mode: TSV per row; when a body is attached, drop it on the next
  // block separated by blank lines + '---' between rows so multi-line
  // bodies are unambiguous.
  const anyBody = msgs.some((m) => m.text != null);
  const fields = msgs.some((m) => m.snippet)
    ? ['id', 'sender', 'subject', 'date', 'snippet']
    : ['id', 'sender', 'subject', 'date'];
  if (!anyBody) {
    return formatRecords(
      msgs.map((m) => ({
        id: m.id,
        sender: m.sender,
        subject: m.subject,
        date: m.dateReceived,
        snippet: m.snippet,
      })),
      {
        json: false,
        fields,
        styles: {
          id: yellow,
          sender: cyan,
          subject: (s) => bold(linkifyGitHub(s)),
          date: green,
          snippet: dim,
        },
      },
    );
  }
  const blocks: string[] = [];
  for (const m of msgs) {
    const tsvRow = formatRecords(
      [
        {
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          date: m.dateReceived,
          snippet: m.snippet,
        },
      ],
      {
        json: false,
        fields,
        styles: {
          id: yellow,
          sender: cyan,
          subject: (s) => bold(linkifyGitHub(s)),
          date: green,
          snippet: dim,
        },
      },
    ).trimEnd();
    blocks.push(m.text != null ? `${tsvRow}\n\n${m.text}\n` : `${tsvRow}\n`);
  }
  return blocks.join('\n---\n\n');
}

/** Calendar-validated Y/M/D from an ISO-ish literal, anchored to the local
 *  zone. Accepts `YYYY-MM-DD` (explicit year) or `MM-DD` / `M-D` (year taken
 *  from `now`, so "05-27" means this year). Throws on malformed or
 *  calendar-invalid input (e.g. 2026-02-30). */
function parseYMD(
  s: string,
  now: Date,
): { year: number; month: number; day: number } {
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const short = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  let year: number;
  let month: number;
  let day: number;
  if (full) {
    year = Number(full[1]);
    month = Number(full[2]);
    day = Number(full[3]);
  } else if (short) {
    year = now.getFullYear();
    month = Number(short[1]);
    day = Number(short[2]);
  } else {
    throw new Error(
      `expected YYYY-MM-DD, MM-DD, or a relative token (today/yesterday/Nd/Nw), got "${s}"`,
    );
  }
  const d = new Date(year, month - 1, day); // local midnight
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new Error(`invalid date: ${s}`);
  }
  return { year, month, day };
}

/** Resolve a relative date token to Unix seconds at *local* midnight, or
 *  return null when `s` isn't one. Recognized (case-insensitive): `today`,
 *  `yesterday`, `<N>d` (N days ago) and `<N>w` (N weeks ago) — all snapped to
 *  the local calendar day, so they pair naturally with `--since` / `--until`. */
function parseRelativeDate(s: string, now: Date): number | null {
  const midnightDaysAgo = (n: number) =>
    Math.floor(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).getTime() / 1000,
    );
  const t = s.trim().toLowerCase();
  if (t === 'today') return midnightDaysAgo(0);
  if (t === 'yesterday') return midnightDaysAgo(1);
  const m = /^(\d+)([dw])$/.exec(t);
  if (m) return midnightDaysAgo(m[2] === 'w' ? Number(m[1]) * 7 : Number(m[1]));
  return null;
}

/** A `--since` / `--until` value → Unix seconds at *local* midnight. Accepts an
 *  absolute date (`YYYY-MM-DD`, or `MM-DD` for the current year) or a relative
 *  token (`today`, `yesterday`, `<N>d`, `<N>w`). Strict, calendar-validated. */
export function parseSearchDate(s: string, now: Date = new Date()): number {
  const relative = parseRelativeDate(s, now);
  if (relative != null) return relative;
  const { year, month, day } = parseYMD(s, now);
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

/** Convert a relative --days window to an absolute Unix-seconds lower bound.
 *  Returns undefined when days is 0 / negative. */
export function relativeDaysToUnixSec(
  days: number,
  now: Date = new Date(),
): number | undefined {
  if (!days || days <= 0) return undefined;
  return Math.floor(now.getTime() / 1000) - days * 86_400;
}

/** Pull ±`contextChars` chars of context around the first case-insensitive
 *  match of `query` in `text`. Whitespace runs collapse to a single space
 *  so the result fits on one line. Returns '' when query is not in text. */
export function makeSnippet(
  text: string,
  query: string,
  contextChars: number,
): string {
  if (!text || !query) return '';
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return '';
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return prefix + slice + suffix;
}

/** Attach decoded text bodies to each row by re-resolving the message to its
 *  storage mailbox URL (always a storage row), converting to a fs path, and
 *  parsing the matching .emlx via mailparser. Rows whose .emlx isn't on
 *  disk are returned unchanged. */
export async function hydrateBodies(
  env: EnvelopeIndex,
  rows: MessageSummary[],
  mailVersionDir: string,
  truncate?: number,
): Promise<MessageSummary[]> {
  // Group rows by storage URL — env.findMessage always resolves to the
  // storage row (messages.mailbox column is storage by definition).
  const storageById = new Map<number, string>();
  for (const r of rows) {
    const m = env.findMessage(r.id);
    if (m?.mailboxUrl) storageById.set(r.id, m.mailboxUrl);
  }
  const byStorage = new Map<string, MessageSummary[]>();
  for (const r of rows) {
    const url = storageById.get(r.id);
    if (!url) continue;
    const arr = byStorage.get(url) ?? [];
    arr.push(r);
    byStorage.set(url, arr);
  }

  const enriched = new Map<number, MessageSummary>();
  for (const [url, group] of byStorage) {
    const fsRoot = mailboxUrlToFsPath(url, mailVersionDir);
    if (!fsRoot) continue;
    const idToPath = await buildIdToPathMap(fsRoot);
    for (const r of group) {
      const p = idToPath.get(r.id);
      if (!p) continue;
      try {
        const parsed = await parseEmlx(p, { id: r.id });
        let text = parsed.text ?? '';
        if (truncate != null && truncate > 0 && text.length > truncate) {
          text = text.slice(0, truncate) + '…';
        }
        enriched.set(r.id, { ...r, text });
      } catch {
        // leave unchanged
      }
    }
  }
  return rows.map((r) => enriched.get(r.id) ?? r);
}

/** Subject search via the Envelope Index — fast, file-system-free. */
export function runSubjectSearch(
  env: EnvelopeIndex,
  opts: SearchOptions,
): MessageSummary[] {
  return env.searchSubject({
    mailboxUrlLike: buildMailboxUrlPattern(opts.account, opts.mailbox),
    query: opts.query,
    max: opts.max,
    filters: opts.filters,
  });
}

/** Walk `root` recursively, collecting `<id>.emlx` / `<id>.partial.emlx`
 *  files into a Map of id → absolute path. One walk per storage mbox. */
async function buildIdToPathMap(root: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile()) {
        const m = e.name.match(/^(\d+)(?:\.partial)?\.emlx$/);
        if (m) map.set(parseInt(m[1], 10), p);
      }
    }
  }
  await walk(root);
  return map;
}

/**
 * Body search: take the envelope's candidate set (mailbox / labels / filter
 * bag already applied), look up each candidate's .emlx file under the
 * matching storage subtree, parse the decoded text body, and grep for
 * `query`. Candidates with no on-disk .emlx are silently dropped (Mail.app
 * leaves some bodies server-side-only).
 */
export async function runBodySearch(
  env: EnvelopeIndex,
  opts: {
    account: string;
    mailbox: string;
    query: string;
    max: number;
    filters?: EnvelopeFilters;
    snippet?: number;
  },
  deps?: RunBodySearchDeps,
): Promise<BodySearchResult> {
  const mailVersionDir = deps?.mailVersionDir ?? findMailVersionDir();

  // Over-fetch so cached-misses + non-matches leave room to land on `max`
  // genuine survivors. Shared helper keeps the cap consistent with the
  // subject path's over-fetch in runSearchWithDefaultIndex.
  const candidates = env.listBodySearchCandidates({
    mailboxUrlLike: buildMailboxUrlPattern(opts.account, opts.mailbox),
    max: overFetchLimit(opts.max),
    filters: opts.filters,
  });

  // Group candidates by storage URL so each storage subtree is walked once.
  const byStorage = new Map<string, BodySearchCandidate[]>();
  for (const c of candidates) {
    const arr = byStorage.get(c.storageMailboxUrl) ?? [];
    arr.push(c);
    byStorage.set(c.storageMailboxUrl, arr);
  }

  const matched: { cand: BodySearchCandidate; snippet?: string }[] = [];
  let examined = 0;

  for (const [storageUrl, group] of byStorage) {
    const fsRoot = mailboxUrlToFsPath(storageUrl, mailVersionDir);
    if (!fsRoot) continue;
    const idToPath = await buildIdToPathMap(fsRoot);
    for (const c of group) {
      const p = idToPath.get(c.id);
      if (!p) continue; // cached-miss — body lives only on the IMAP server
      examined++;
      let parsed;
      try {
        parsed = await parseEmlx(p, { id: c.id });
      } catch {
        continue;
      }
      const text = parsed.text ?? '';
      if (text.toLowerCase().indexOf(opts.query.toLowerCase()) < 0) continue;
      const snippet =
        opts.snippet && opts.snippet > 0
          ? makeSnippet(text, opts.query, opts.snippet)
          : undefined;
      matched.push({ cand: c, snippet });
    }
  }

  matched.sort(
    (a, b) =>
      (b.cand.dateReceived?.getTime() ?? 0) -
      (a.cand.dateReceived?.getTime() ?? 0),
  );
  const sliced = matched.slice(0, opts.max);

  return {
    rows: sliced.map(({ cand, snippet }) => ({
      id: cand.id,
      sender: cand.sender,
      subject: cand.subject,
      dateReceived: cand.dateReceived,
      read: false,
      flags: 0,
      mailboxId: -1,
      mailboxUrl: cand.storageMailboxUrl,
      snippet,
    })),
    total: matched.length,
    examined,
  };
}

/** Merge subject + body results, dedup by message id, newest first. */
export function mergeResults(
  a: MessageSummary[],
  b: MessageSummary[],
  max: number,
): MessageSummary[] {
  const byId = new Map<number, MessageSummary>();
  for (const m of [...a, ...b]) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  return Array.from(byId.values())
    .sort(
      (x, y) =>
        (y.dateReceived?.getTime() ?? 0) - (x.dateReceived?.getTime() ?? 0),
    )
    .slice(0, max);
}

/**
 * Turn a `SearchOutcome` into stdout-ready text. Behaviour:
 *
 * - text mode: row lines (TSV) followed by a `(showing M of N)` trailer
 *   when total > rows.length. countOnly prints just `total: N` and
 *   (when set) `examined: K`.
 * - JSON mode: NDJSON row lines followed by a `{"_summary": {...}}`
 *   line. countOnly emits only the summary line.
 */
export function formatSearchOutput(
  outcome: SearchOutcome,
  opts: { json: boolean; max: number; countOnly?: boolean },
): string {
  if (opts.countOnly) {
    if (opts.json) {
      const summary: Record<string, number> = {
        shown: 0,
        total: outcome.total,
      };
      if (outcome.examined != null) summary.examined = outcome.examined;
      return JSON.stringify({ _summary: summary }) + '\n';
    }
    const lines = [`total: ${outcome.total}`];
    if (outcome.examined != null) {
      lines.push(`examined: ${outcome.examined}`);
    }
    return lines.join('\n') + '\n';
  }
  const body = formatRows(outcome.rows, opts.json);
  if (opts.json) {
    if (outcome.rows.length === 0 && outcome.total === 0) return '';
    const summary: Record<string, number> = {
      shown: outcome.rows.length,
      total: outcome.total,
    };
    if (outcome.examined != null) summary.examined = outcome.examined;
    return body + JSON.stringify({ _summary: summary }) + '\n';
  }
  if (outcome.total > outcome.rows.length) {
    return (
      body +
      `(showing ${outcome.rows.length} of ${outcome.total} — narrow filters if too many)\n`
    );
  }
  return body;
}

function overFetchLimit(max: number): number {
  return Math.min(Math.max(max * 10, 200), 1000);
}

export async function runSearchWithDefaultIndex(
  opts: SearchOptions,
): Promise<SearchOutcome> {
  const env = new EI(defaultEnvelopeIndexPath());
  try {
    const fetchCap = overFetchLimit(opts.max);
    const subjectMatches =
      opts.scope === 'body'
        ? []
        : runSubjectSearch(env, { ...opts, max: fetchCap });

    let bodyResult: BodySearchResult | null = null;
    if (opts.scope !== 'subject') {
      bodyResult = await runBodySearch(env, {
        account: opts.account,
        mailbox: opts.mailbox,
        query: opts.query ?? '',
        max: fetchCap,
        filters: opts.filters,
        snippet: opts.snippet,
      });
    }

    const bodyMatches = bodyResult?.rows ?? [];
    let unioned: MessageSummary[];
    if (opts.scope === 'both') {
      unioned = mergeResults(subjectMatches, bodyMatches, fetchCap);
    } else if (opts.scope === 'subject') {
      unioned = subjectMatches;
    } else {
      unioned = bodyMatches;
    }

    const total = unioned.length;
    let rows = opts.countOnly ? [] : unioned.slice(0, opts.max);

    if (opts.body != null && rows.length > 0) {
      rows = await hydrateBodies(env, rows, findMailVersionDir(), opts.body);
    }

    return {
      rows,
      total,
      examined: bodyResult?.examined,
    };
  } finally {
    env.close();
  }
}
