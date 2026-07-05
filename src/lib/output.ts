// output.ts — record formatters for text and NDJSON output modes.

export type Row = Record<string, unknown>;

export interface FormatOptions {
  json: boolean;
  /** Field order for text mode. Defaults to Object.keys of the first row. */
  fields?: string[];
  /** Text-mode field separator (non-aligned mode). Defaults to TAB. */
  separator?: string;
  /** Text-mode per-field styling fns (e.g. from lib/color). Ignored in JSON. */
  styles?: Record<string, (s: string) => string>;
  /** Pad columns so they line up vertically (text mode). Width-aware: ANSI
   *  escapes count as 0 columns, CJK/emoji as 2. */
  align?: boolean;
}

/** Build local-time ISO 8601 with a ±HH:MM offset, e.g. 2026-06-01T03:43:58+09:00. */
export function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC (KST → +540)
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`
  );
}

// Human date styles for TEXT output (mirrors maccal). Pipes and --json always
// stay UTC ISO (machine contract); only text output uses a readable style.
//   iso      → 2026-07-06T09:30:00+09:00  (local, with offset — the machine form)
//   readable → 2026-07-06 09:30           (default: date + HH:MM, no seconds/offset)
//   friendly → Mon Jul 6 09:30            (weekday + month name)
//   compact  → Jul 6 09:30                (month name + day; year added when not this year)
export type DateStyle = 'iso' | 'readable' | 'friendly' | 'compact';
const DATE_STYLES: readonly DateStyle[] = ['iso', 'readable', 'friendly', 'compact'];

let dateStyle: DateStyle = 'readable';

/** Set the module-wide text date style (from config / --iso), once per command.
 *  An unknown value falls back to the default (readable). */
export function configureDateStyle(s: string | undefined): void {
  const v = (s ?? 'readable').toLowerCase();
  dateStyle = DATE_STYLES.includes(v as DateStyle) ? (v as DateStyle) : 'readable';
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** `Jul 6`, plus ` 2027` when the date's year differs from now's. */
function monthDay(d: Date, now: Date): string {
  const base = `${MONTHS[d.getMonth() + 1]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Render a Date in the given (or module-wide) text style. */
export function formatDate(d: Date, style: DateStyle = dateStyle, now: Date = new Date()): string {
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const hhmm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  switch (style) {
    case 'iso':
      return toLocalISO(d);
    case 'friendly':
      return `${WEEKDAYS[d.getDay()]} ${monthDay(d, now)} ${hhmm}`;
    case 'compact':
      return `${monthDay(d, now)} ${hhmm}`;
    default:
      return `${ymd} ${hhmm}`; // readable
  }
}

/** Compact sender label from an RFC5322 `Name <addr>`: the display name
 *  (unquoted), or the bare address when there is no name. */
export function senderDisplayName(raw: string): string {
  if (!raw) return '';
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (m) {
    const name = m[1].replace(/^"(.*)"$/, '$1').trim();
    return name || m[2].trim();
  }
  return raw.trim();
}

const WIDE =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0xfe0f) return 0; // variation selector
  if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) return 2; // emoji / symbols
  return WIDE.test(ch) ? 2 : 1;
}

// ANSI SGR color codes and OSC 8 hyperlinks — zero printable width.
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Printable column width: ANSI/OSC-8 escapes count 0, CJK/emoji count 2. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s.replace(ANSI, '')) w += charWidth(ch);
  return w;
}

/** Truncate to at most `max` display columns, appending '…' when cut. */
export function truncateWidth(s: string, max: number): string {
  if (max <= 0 || displayWidth(s) <= max) return displayWidth(s) <= max ? s : '';
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function stringifyCell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return formatDate(v);
  return String(v);
}

export function formatRecords(rows: Row[], opts: FormatOptions): string {
  if (rows.length === 0) return '';
  if (opts.json) {
    return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
  const fields = opts.fields ?? Object.keys(rows[0] ?? {});
  const styles = opts.styles;
  const styled = (f: string, raw: string): string => (styles?.[f] ? styles[f](raw) : raw);

  if (opts.align) {
    const widths = fields.map((f) =>
      rows.reduce((mx, r) => Math.max(mx, displayWidth(stringifyCell(r[f]))), 0),
    );
    return (
      rows
        .map((r) =>
          fields
            .map((f, i) => {
              const raw = stringifyCell(r[f]);
              const cell = styled(f, raw);
              // Last column needs no trailing padding.
              return i === fields.length - 1
                ? cell
                : cell + ' '.repeat(widths[i] - displayWidth(raw));
            })
            .join('  '),
        )
        .join('\n') + '\n'
    );
  }

  const sep = opts.separator ?? '\t';
  return (
    rows.map((r) => fields.map((f) => styled(f, stringifyCell(r[f]))).join(sep)).join('\n') + '\n'
  );
}
