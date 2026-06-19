import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runAppleScript, isMailRunning, canReadMailDir } from '../src/lib/osascript.ts';

const ECHO_AS = join(import.meta.dir, 'fixtures', 'echo.applescript');

describe('runAppleScript', () => {
  test('passes argv through to the script', () => {
    const out = runAppleScript(ECHO_AS, ['hello', 'world']).trim();
    expect(out).toBe('ok:2:hello');
  });
  test('zero args is valid', () => {
    const out = runAppleScript(ECHO_AS, []).trim();
    expect(out).toBe('ok:0:');
  });
  test('throws on missing script path', () => {
    expect(() => runAppleScript('/nonexistent.applescript', [])).toThrow();
  });
});

describe('isMailRunning', () => {
  // We can't assert true/false here since Mail.app may or may not be running
  // on whatever machine runs the tests. Just verify the return shape.
  test('returns a boolean', () => {
    expect(typeof isMailRunning()).toBe('boolean');
  });
});

describe('canReadMailDir', () => {
  test('returns a boolean (true if FDA granted, false otherwise)', () => {
    expect(typeof canReadMailDir()).toBe('boolean');
  });
});
