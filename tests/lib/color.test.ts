import { describe, it, expect, afterEach } from 'bun:test';
import {
  configureColor,
  setColorEnabled,
  colorIsEnabled,
  dim,
  yellow,
} from '../../src/lib/color.ts';

const origTTY = process.stdout.isTTY;

afterEach(() => {
  (process.stdout as unknown as { isTTY: boolean }).isTTY = origTTY;
  delete process.env.NO_COLOR;
  setColorEnabled(false);
});

describe('color gating', () => {
  it('style helpers wrap when enabled, pass through when not', () => {
    setColorEnabled(true);
    expect(dim('x')).toBe('\x1b[90mx\x1b[0m');
    setColorEnabled(false);
    expect(dim('x')).toBe('x');
  });

  it('never styles an empty string', () => {
    setColorEnabled(true);
    expect(yellow('')).toBe('');
  });

  it('is ON by default on a TTY', () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    configureColor({});
    expect(colorIsEnabled()).toBe(true);
  });

  it('is OFF for --no-color, JSON, NO_COLOR, or a non-TTY', () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;

    configureColor({ color: false });
    expect(colorIsEnabled()).toBe(false);

    configureColor({ json: true });
    expect(colorIsEnabled()).toBe(false);

    process.env.NO_COLOR = ''; // presence-based: even an empty value disables
    configureColor({});
    expect(colorIsEnabled()).toBe(false);
    delete process.env.NO_COLOR;

    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    configureColor({});
    expect(colorIsEnabled()).toBe(false);
  });
});
