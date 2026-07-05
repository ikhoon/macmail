import { describe, expect, test } from 'bun:test';
import { formatAccounts } from '../../src/commands/accounts.ts';
import type { Account } from '../../src/lib/mail-data.ts';

const SAMPLE: Account[] = [
  { uuid: 'AAAAAAAA-1111-2222-3333-444444444444', name: 'Personal',  email: 'personal@example.com',     type: 'Gmail' },
  { uuid: 'BBBBBBBB-1111-2222-3333-444444444444', name: 'Work',      email: 'user@example.com',     type: 'Gmail' },
  { uuid: 'DDDDDDDD-1111-2222-3333-444444444444', name: 'On My Mac', email: null,                   type: 'On My Device' },
];

describe('accounts command', () => {
  test('text mode emits TSV with name/email/type per line', () => {
    const out = formatAccounts(SAMPLE, { json: false });
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split(/ {2,}/)).toEqual(['Personal', 'personal@example.com', 'Gmail']);
    expect(lines[1].split(/ {2,}/)).toEqual(['Work', 'user@example.com', 'Gmail']);
    // A no-email account: aligned text leaves the email column blank.
    expect(lines[2].startsWith('On My Mac')).toBe(true);
    expect(lines[2].trimEnd().endsWith('On My Device')).toBe(true);
    expect(lines[2]).not.toContain('@');
  });

  test('json mode emits NDJSON with account/email/type/uuid', () => {
    const out = formatAccounts(SAMPLE, { json: true });
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      account: 'Personal',
      email: 'personal@example.com',
      type: 'Gmail',
      uuid: 'AAAAAAAA-1111-2222-3333-444444444444',
    });
    expect(lines[2].email).toBe('');
  });

  test('empty account list yields empty string', () => {
    expect(formatAccounts([], { json: false })).toBe('');
    expect(formatAccounts([], { json: true })).toBe('');
  });
});
