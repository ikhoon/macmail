import { describe, it, expect, afterEach } from 'bun:test';
import { setColorEnabled } from '../../src/lib/color.ts';
import { linkifyGitHub, osc8 } from '../../src/lib/links.ts';

afterEach(() => setColorEnabled(false));

describe('linkifyGitHub', () => {
  it('no-ops when rich output is off (piped / --json / --no-color)', () => {
    setColorEnabled(false);
    const s = '[ikhoon/macmail] Add colored output (PR #6)';
    expect(linkifyGitHub(s)).toBe(s);
  });

  it('links PR #N to /pull/N', () => {
    setColorEnabled(true);
    const out = linkifyGitHub('[ikhoon/macmail] Add colored output (PR #6)');
    expect(out).toContain(osc8('https://github.com/ikhoon/macmail/pull/6', 'PR #6'));
  });

  it('links a bare #N as an issue', () => {
    setColorEnabled(true);
    const out = linkifyGitHub('[ikhoon/macrec] Investigate flake #42');
    expect(out).toContain(osc8('https://github.com/ikhoon/macrec/issues/42', '#42'));
  });

  it('leaves subjects without a [owner/repo] tag untouched', () => {
    setColorEnabled(true);
    const s = 'A normal subject that mentions #5 without a repo';
    expect(linkifyGitHub(s)).toBe(s);
  });

  it('only links when the [owner/repo] tag is at the start of the subject', () => {
    setColorEnabled(true);
    const s = 'Re: notes about [not/arepo] and #5';
    expect(linkifyGitHub(s)).toBe(s);
  });
});
