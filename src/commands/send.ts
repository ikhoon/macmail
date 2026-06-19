// commands/send.ts — compose and send (or draft) a new message via AppleScript.

import { join } from 'node:path';
import {
  ensureMailRunning,
  runAppleScript as defaultRunner,
} from '../lib/osascript.ts';
import {
  ttyConfirmer,
  autoYesConfirmer,
  type Confirmer,
} from '../lib/confirm.ts';

export interface SendOptions {
  to: string;
  subject: string;
  body: string;
  cc: string;
  bcc: string;
  draft: boolean;
  dryRun: boolean;
  yes: boolean;
}

export interface SendDeps {
  scriptPath: string;
  runApplescript?: (path: string, args: string[]) => string;
  confirmer?: Confirmer;
  ensureRunning?: () => Promise<void>;
}

function formatSendBody(opts: SendOptions): string {
  return [
    `  To:      ${opts.to}`,
    `  Cc:      ${opts.cc}`,
    `  Bcc:     ${opts.bcc}`,
    `  Subject: ${opts.subject}`,
    '',
    opts.body,
    '',
  ].join('\n');
}

export function formatSendPreview(opts: SendOptions, verb: string): string {
  return `${verb}:\n${formatSendBody(opts)}`;
}

export async function runSend(opts: SendOptions, deps: SendDeps): Promise<string> {
  if (!opts.to) throw new Error('send: --to is required');
  if (!opts.subject) throw new Error('send: --subject is required');
  if (!opts.body) throw new Error('send: --body is required');

  const action = opts.draft ? 'create draft' : 'SEND';

  if (opts.dryRun) {
    return `DRY-RUN: would ${action.toLowerCase()}\n${formatSendBody(opts)}`;
  }

  process.stderr.write(formatSendPreview(opts, `About to ${action}`));
  const confirmer = deps.confirmer ?? (opts.yes ? autoYesConfirmer : ttyConfirmer);
  const ok = await confirmer.prompt('Proceed?');
  if (!ok) throw new Error('aborted');

  await (deps.ensureRunning ?? ensureMailRunning)();
  const runner = deps.runApplescript ?? defaultRunner;
  runner(deps.scriptPath, [
    opts.to,
    opts.subject,
    opts.body,
    opts.cc,
    opts.bcc,
    opts.draft ? '1' : '0',
  ]);
  return 'ok\n';
}

export function defaultSendScript(repoRoot: string): string {
  return join(repoRoot, 'lib', 'applescript', 'send.applescript');
}
