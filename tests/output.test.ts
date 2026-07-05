import { describe, expect, test, it } from 'bun:test';
import {
  formatRecords,
  displayWidth,
  truncateWidth,
  senderDisplayName,
  formatDate,
  configureDateStyle,
} from '../src/lib/output.ts';

describe('formatRecords', () => {
  test('text mode joins all fields by tab, one row per line, trailing newline', () => {
    const out = formatRecords(
      [{ id: '1', sender: 'alice', subject: 'hi', date: 'today' }],
      { json: false },
    );
    expect(out).toBe('1\talice\thi\ttoday\n');
  });

  test('json mode emits NDJSON', () => {
    const out = formatRecords([{ id: '1', name: 'a' }], { json: true });
    expect(out).toBe('{"id":"1","name":"a"}\n');
  });

  test('multi-row text mode emits one row per line', () => {
    const out = formatRecords([{ x: 'a' }, { x: 'b' }, { x: 'c' }], { json: false });
    expect(out).toBe('a\nb\nc\n');
  });

  test('multi-row json mode emits one object per line', () => {
    const out = formatRecords([{ x: 1 }, { x: 2 }], { json: true });
    expect(out).toBe('{"x":1}\n{"x":2}\n');
  });

  test('honors explicit field ordering in text mode', () => {
    const out = formatRecords(
      [{ id: '1', sender: 'alice', subject: 'hi' }],
      { json: false, fields: ['sender', 'id'] },
    );
    expect(out).toBe('alice\t1\n');
  });

  test('empty array yields empty string', () => {
    expect(formatRecords([], { json: false })).toBe('');
    expect(formatRecords([], { json: true })).toBe('');
  });

  test('null and undefined render as empty in text mode', () => {
    const out = formatRecords([{ a: 'x', b: null, c: undefined }], {
      json: false,
      fields: ['a', 'b', 'c'],
    });
    expect(out).toBe('x\t\t\n');
  });

  test('Date renders in the readable style in text mode, UTC in json mode', () => {
    const d = new Date('2026-05-27T10:00:00Z');

    // JSON stays machine-readable UTC (jq pipelines depend on it).
    expect(formatRecords([{ when: d }], { json: true })).toBe(
      '{"when":"2026-05-27T10:00:00.000Z"}\n',
    );

    // Text default is the readable style: local `YYYY-MM-DD HH:MM`, no seconds
    // or offset. Asserted by shape (holds in any timezone).
    const text = formatRecords([{ when: d }], { json: false }).trimEnd();
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('numbers stringify in text mode and stay numeric in json mode', () => {
    const text = formatRecords([{ n: 42 }], { json: false });
    expect(text).toBe('42\n');
    const json = formatRecords([{ n: 42 }], { json: true });
    expect(json).toBe('{"n":42}\n');
  });

  test('custom separator', () => {
    const out = formatRecords([{ a: 'x', b: 'y' }], { json: false, separator: ',' });
    expect(out).toBe('x,y\n');
  });

  test('align pads columns to a common display width', () => {
    const out = formatRecords(
      [
        { a: 'x', b: 'hi' },
        { a: 'yy', b: 'z' },
      ],
      { json: false, fields: ['a', 'b'], align: true },
    );
    // Column a padded to width 2 (+ a 2-space gap); the last column isn't padded.
    expect(out).toBe('x   hi\nyy  z\n');
  });
});

describe('display helpers', () => {
  test('displayWidth counts CJK as 2, ANSI escapes as 0', () => {
    expect(displayWidth('ab')).toBe(2);
    expect(displayWidth('엄')).toBe(2);
    expect(displayWidth('\x1b[96mx\x1b[0m')).toBe(1);
  });

  test('truncateWidth cuts by display width with an ellipsis', () => {
    expect(truncateWidth('hello', 10)).toBe('hello');
    expect(truncateWidth('hello world', 6)).toBe('hello…');
  });

  test('senderDisplayName returns the display name, or the address when none', () => {
    expect(senderDisplayName('Alice <a@x.com>')).toBe('Alice');
    expect(senderDisplayName('"Bob B" <b@x.com>')).toBe('Bob B');
    expect(senderDisplayName('c@x.com')).toBe('c@x.com');
  });
});

describe('formatDate styles', () => {
  // A fixed local wall-clock instant (constructed in local tz so components are
  // stable regardless of where the test runs).
  const d = new Date(2026, 6, 6, 9, 30, 5); // 2026-07-06 09:30:05 local, a Monday
  const now = new Date(2026, 6, 20);

  it('readable (default): date + HH:MM, no seconds/offset', () => {
    expect(formatDate(d, 'readable', now)).toBe('2026-07-06 09:30');
  });
  it('iso: full local ISO with offset', () => {
    expect(formatDate(d, 'iso', now)).toMatch(/^2026-07-06T09:30:05[+-]\d{2}:\d{2}$/);
  });
  it('friendly: weekday + month name + HH:MM', () => {
    expect(formatDate(d, 'friendly', now)).toBe('Mon Jul 6 09:30');
  });
  it('compact: month name + day + HH:MM, adding the year only when not this year', () => {
    expect(formatDate(d, 'compact', now)).toBe('Jul 6 09:30');
    expect(formatDate(new Date(2027, 0, 2, 8, 5, 0), 'compact', now)).toBe('Jan 2 2027 08:05');
  });
  it('configureDateStyle sets the module default; unknown falls back to readable', () => {
    configureDateStyle('friendly');
    expect(formatDate(d, undefined, now)).toBe('Mon Jul 6 09:30');
    configureDateStyle('nonsense');
    expect(formatDate(d, undefined, now)).toBe('2026-07-06 09:30');
    configureDateStyle(undefined); // reset to readable
  });
});
