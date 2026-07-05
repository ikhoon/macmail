import { describe, it, expect } from 'bun:test';
import { configPath, parseConfig, loadConfig } from '../../src/lib/config.ts';

describe('configPath resolution (flag > env order)', () => {
  it('prefers MACMAIL_CONFIG, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(configPath({ MACMAIL_CONFIG: '/explicit.json' } as any, '/h')).toBe('/explicit.json');
    expect(configPath({ XDG_CONFIG_HOME: '/xdg' } as any, '/h')).toBe(
      '/xdg/macmail/config.json',
    );
    expect(configPath({} as any, '/h')).toBe('/h/.config/macmail/config.json');
  });
});

describe('parseConfig', () => {
  it('reads the known keys', () => {
    const c = parseConfig(
      '{"defaultAccount":"Work","defaultMailbox":"JIRA","color":"always","full":true}',
    );
    expect(c).toEqual({
      defaultAccount: 'Work',
      defaultMailbox: 'JIRA',
      color: 'always',
      full: true,
    });
  });

  it('an empty object yields all-undefined defaults', () => {
    expect(parseConfig('{}')).toEqual({
      defaultAccount: undefined,
      defaultMailbox: undefined,
      color: undefined,
    });
  });

  it('ignores unknown keys (forward-compatible)', () => {
    const c = parseConfig('{"defaultAccount":"Work","futureKnob":42}');
    expect(c.defaultAccount).toBe('Work');
  });

  it('throws on a wrong-typed value', () => {
    expect(() => parseConfig('{"full":"yes"}')).toThrow(/"full" must be a boolean/);
    expect(() => parseConfig('{"defaultAccount":5}')).toThrow(/must be a string/);
    expect(() => parseConfig('{"color":"rainbow"}')).toThrow(/"auto", "always", or "never"/);
  });

  it('throws on a non-object root', () => {
    expect(() => parseConfig('[]')).toThrow(/must be a JSON object/);
  });
});

describe('loadConfig', () => {
  it('returns defaults when the file is missing (not an error)', () => {
    expect(loadConfig({ MACMAIL_CONFIG: '/no/such/config.json' } as any, '/h')).toEqual({});
  });
});
