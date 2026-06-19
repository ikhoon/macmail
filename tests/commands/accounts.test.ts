import { describe, expect, test } from 'bun:test';
import { formatAccounts } from '../../src/commands/accounts.ts';
import type { Account } from '../../src/lib/mail-data.ts';

const SAMPLE: Account[] = [
  { uuid: 'A4E92B36-90A1-4BA5-AD06-2A5E6179D603', name: 'Personal',  email: 'personal@example.com',     type: 'Gmail' },
  { uuid: 'DC1EB047-9021-45D6-A252-50FF783B0335', name: 'Work',      email: 'user@example.com',     type: 'Gmail' },
  { uuid: '7DDA5222-2321-466C-897F-E7B80F097675', name: 'On My Mac', email: null,                   type: 'On My Device' },
];

describe('accounts command', () => {
  test('text mode emits TSV with name/email/type per line', () => {
    const out = formatAccounts(SAMPLE, { json: false });
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split('\t')).toEqual(['Personal', 'personal@example.com', 'Gmail']);
    expect(lines[1].split('\t')).toEqual(['Work', 'user@example.com', 'Gmail']);
    expect(lines[2].split('\t')).toEqual(['On My Mac', '', 'On My Device']);
  });

  test('json mode emits NDJSON with account/email/type/uuid', () => {
    const out = formatAccounts(SAMPLE, { json: true });
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      account: 'Personal',
      email: 'personal@example.com',
      type: 'Gmail',
      uuid: 'A4E92B36-90A1-4BA5-AD06-2A5E6179D603',
    });
    expect(lines[2].email).toBe('');
  });

  test('empty account list yields empty string', () => {
    expect(formatAccounts([], { json: false })).toBe('');
    expect(formatAccounts([], { json: true })).toBe('');
  });
});
