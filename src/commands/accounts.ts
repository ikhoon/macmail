// commands/accounts.ts — list configured Mail.app accounts.

import type { Account } from '../lib/mail-data.ts';
import { listAccounts } from '../lib/mail-data.ts';
import { formatRecords } from '../lib/output.ts';
import { cyan, dim, magenta } from '../lib/color.ts';

export interface AccountsOptions {
  json: boolean;
}

export function formatAccounts(accts: Account[], opts: AccountsOptions): string {
  return formatRecords(
    accts.map((a) => ({
      account: a.name,
      email: a.email ?? '',
      type: a.type,
      uuid: a.uuid,
    })),
    {
      json: opts.json,
      // Text mode shows the columns most useful for selecting an account.
      // JSON includes all fields, UUID included.
      fields: opts.json ? undefined : ['account', 'email', 'type'],
      styles: { account: magenta, email: cyan, type: dim },
    },
  );
}

export function runAccounts(opts: AccountsOptions): string {
  return formatAccounts(listAccounts(), opts);
}
