// links.ts — turn GitHub references in a subject into clickable terminal links.
//
// GitHub notification subjects look like: "[owner/repo] Title (PR #19)". When
// such a subject is shown in a terminal, wrap the "PR #19" / "#19" reference in
// an OSC 8 hyperlink to https://github.com/owner/repo/pull|issues/19. Terminals
// that support OSC 8 (iTerm2, Terminal.app, VS Code, WezTerm, kitty, …) render
// it as a clickable link; others just show the text unchanged.
//
// Gated on colorIsEnabled() — so piped / redirected / --json / --no-color output
// stays plain (no escape codes leak into scripts).

import { colorIsEnabled } from './color.ts';

const OSC = '\x1b]8;;';
const ST = '\x1b\\';

/** Wrap `text` in an OSC 8 hyperlink to `url`. */
export function osc8(url: string, text: string): string {
  return `${OSC}${url}${ST}${text}${OSC}${ST}`;
}

/**
 * Linkify GitHub `PR #N` / `Issue #N` / `#N` references in a notification-style
 * subject that carries an `[owner/repo]` tag. No-op unless rich output is on and
 * the subject actually carries a repo tag + a reference.
 */
export function linkifyGitHub(subject: string): string {
  if (!colorIsEnabled() || !subject) return subject;
  // GitHub notification subjects start with the "[owner/repo]" tag; anchoring to
  // the start avoids false-positive links on unrelated "[a/b]" text elsewhere.
  const repo = subject.match(/^\[([\w.-]+\/[\w.-]+)\]/)?.[1];
  if (!repo) return subject;
  return subject.replace(/(?:\b(PR|Issue) )?#(\d+)\b/g, (whole, kind: string | undefined, n: string) => {
    const path = kind === 'PR' ? 'pull' : 'issues';
    return osc8(`https://github.com/${repo}/${path}/${n}`, whole);
  });
}
