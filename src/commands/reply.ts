// commands/reply.ts — reply (or reply-all) to a message via AppleScript.

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

export interface ReplyOptions {
  account: string;
  mailbox: string;
  id: number;
  body: string;
  all: boolean;
  draft: boolean;
  dryRun: boolean;
  yes: boolean;
}

export interface ReplyDeps {
  scriptPath: string;
  runApplescript?: (path: string, args: string[]) => string;
  confirmer?: Confirmer;
  ensureRunning?: () => Promise<void>;
}

function formatReplyBody(opts: ReplyOptions): string {
  const kind = opts.all ? 'reply-all' : 'reply';
  return [
    `  Target:  message ${opts.id} (${opts.account}/${opts.mailbox})`,
    `  Mode:    ${kind}`,
    `  Body:`,
    '',
    opts.body,
    '',
  ].join('\n');
}

export function formatReplyPreview(opts: ReplyOptions, verb: string): string {
  return `${verb}:\n${formatReplyBody(opts)}`;
}

export async function runReply(opts: ReplyOptions, deps: ReplyDeps): Promise<string> {
  if (!opts.body) throw new Error('reply: --body is required');

  const kind = opts.all ? 'reply-all' : 'reply';
  const action = opts.draft ? `draft ${kind}` : `SEND ${kind}`;

  if (opts.dryRun) {
    return `DRY-RUN: would ${action.toLowerCase()}\n${formatReplyBody(opts)}`;
  }

  process.stderr.write(formatReplyPreview(opts, `About to ${action}`));
  const confirmer = deps.confirmer ?? (opts.yes ? autoYesConfirmer : ttyConfirmer);
  const ok = await confirmer.prompt('Proceed?');
  if (!ok) throw new Error('aborted');

  await (deps.ensureRunning ?? ensureMailRunning)();
  const runner = deps.runApplescript ?? defaultRunner;
  runner(deps.scriptPath, [
    opts.account,
    opts.mailbox,
    String(opts.id),
    opts.body,
    opts.all ? '1' : '0',
    opts.draft ? '1' : '0',
  ]);
  return 'ok\n';
}

export function defaultReplyScript(repoRoot: string): string {
  return join(repoRoot, 'lib', 'applescript', 'reply.applescript');
}
