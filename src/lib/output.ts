// output.ts — record formatters for the text (TSV) and NDJSON output modes.

export type Row = Record<string, unknown>;

export interface FormatOptions {
  json: boolean;
  /** Field order for text mode. Defaults to Object.keys of the first row. */
  fields?: string[];
  /** Text-mode field separator. Defaults to TAB. */
  separator?: string;
  /** Text-mode only: per-field styling fns (e.g. from lib/color). Each maps a
   *  field name to a transform applied to that cell; missing fields are left
   *  as-is. Ignored in JSON mode. */
  styles?: Record<string, (s: string) => string>;
}

/** Render a Date as local-time ISO 8601 with offset, e.g.
 *  2026-06-01T03:43:58+09:00. Text output is for humans, so it shows the
 *  reader's local zone (matching the local-midnight `--since` / `--until`
 *  filters); JSON mode keeps UTC via JSON.stringify's default. */
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

function stringifyCell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return toLocalISO(v);
  return String(v);
}

export function formatRecords(rows: Row[], opts: FormatOptions): string {
  if (rows.length === 0) return '';
  if (opts.json) {
    return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
  const sep = opts.separator ?? '\t';
  const fields = opts.fields ?? Object.keys(rows[0] ?? {});
  const styles = opts.styles;
  return (
    rows
      .map((r) =>
        fields
          .map((f) => {
            const cell = stringifyCell(r[f]);
            return styles?.[f] ? styles[f](cell) : cell;
          })
          .join(sep),
      )
      .join('\n') + '\n'
  );
}
