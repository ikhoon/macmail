// commands/mark.ts — mark a message read or unread via AppleScript.

import { join } from 'node:path';
import { yellow } from '../lib/color.ts';
import {
  ensureMailRunning,
  runAppleScript as defaultRunner,
} from '../lib/osascript.ts';
import {
  ttyConfirmer,
  autoYesConfirmer,
  type Confirmer,
} from '../lib/confirm.ts';

export type MarkState = 'read' | 'unread';

export interface MarkOptions {
  account: string;
  mailbox: string;
  id: number;
  state: MarkState;
  dryRun: boolean;
  yes: boolean;
}

export interface MarkDeps {
  scriptPath: string;
  runApplescript?: (path: string, args: string[]) => string;
  confirmer?: Confirmer;
  ensureRunning?: () => Promise<void>;
}

export function formatMarkPreview(opts: MarkOptions, verb = 'Mark'): string {
  return `${verb} message ${opts.id} (${opts.account}/${opts.mailbox}) as ${opts.state}`;
}

export async function runMark(opts: MarkOptions, deps: MarkDeps): Promise<string> {
  if (opts.dryRun) {
    return `${yellow('DRY-RUN:')} would ${formatMarkPreview(opts, 'mark')}\n`;
  }
  const confirmer = deps.confirmer ?? (opts.yes ? autoYesConfirmer : ttyConfirmer);
  const ok = await confirmer.prompt(`${formatMarkPreview(opts)}?`);
  if (!ok) throw new Error('aborted');
  await (deps.ensureRunning ?? ensureMailRunning)();
  const runner = deps.runApplescript ?? defaultRunner;
  runner(deps.scriptPath, [opts.account, opts.mailbox, String(opts.id), opts.state]);
  return 'ok\n';
}

export function defaultMarkScript(repoRoot: string): string {
  return join(repoRoot, 'lib', 'applescript', 'mark.applescript');
}
