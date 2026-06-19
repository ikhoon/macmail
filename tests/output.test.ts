import { describe, expect, test } from 'bun:test';
import { formatRecords } from '../src/lib/output.ts';

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

  test('Date renders as local ISO+offset in text mode, UTC in json mode', () => {
    const d = new Date('2026-05-27T10:00:00Z');

    // JSON stays machine-readable UTC (jq pipelines depend on it).
    expect(formatRecords([{ when: d }], { json: true })).toBe(
      '{"when":"2026-05-27T10:00:00.000Z"}\n',
    );

    // Text is for humans: ISO 8601 in the local zone with a ±HH:MM offset,
    // no trailing Z — but the same absolute instant. Asserted by shape +
    // round-trip so the test holds in any timezone.
    const text = formatRecords([{ when: d }], { json: false }).trimEnd();
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(text.endsWith('Z')).toBe(false);
    expect(new Date(text).getTime()).toBe(d.getTime());
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
});
