// config.ts — CLI defaults loaded from a JSON file.
//
// Resolution (first hit wins): $MACMAIL_CONFIG → $XDG_CONFIG_HOME/macmail/config.json
// → ~/.config/macmail/config.json. A missing file is not an error — you get the
// built-in defaults. Unknown keys are ignored so an older CLI tolerates a newer
// file. Every value is a *default*: an explicit CLI flag (or env var) always
// wins over it — precedence: flag > env > config file > built-in.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export interface MacmailConfig {
  /** Default `--account` selector (description / email / UUID). */
  defaultAccount?: string;
  /** Default `--mailbox`. */
  defaultMailbox?: string;
  /** Color mode: "auto" (color on a TTY — the default), "always", "never". */
  color?: string;
  /** Default for `--full` (show the full `Name <email>` sender). */
  full?: boolean;
  /** Text date style: "readable" (default), "iso", "friendly", "compact". */
  dateFormat?: string;
}

/** The config path per the resolution order above. */
export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (env.MACMAIL_CONFIG) return env.MACMAIL_CONFIG;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'macmail', 'config.json');
  return join(home, '.config', 'macmail', 'config.json');
}

/** Parse + validate config JSON. Throws on malformed JSON or a wrong-typed key
 *  so the caller can warn rather than silently misconfigure. Unknown keys are
 *  ignored (forward-compatible). */
export function parseConfig(text: string): MacmailConfig {
  const raw: unknown = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => {
    if (o[k] === undefined) return undefined;
    if (typeof o[k] !== 'string') throw new Error(`config: "${k}" must be a string`);
    return o[k] as string;
  };
  const cfg: MacmailConfig = {
    defaultAccount: str('defaultAccount'),
    defaultMailbox: str('defaultMailbox'),
    color: str('color'),
    dateFormat: str('dateFormat'),
  };
  if (o.full !== undefined) {
    if (typeof o.full !== 'boolean') throw new Error('config: "full" must be a boolean');
    cfg.full = o.full;
  }
  if (cfg.color !== undefined && !['auto', 'always', 'never'].includes(cfg.color.toLowerCase())) {
    throw new Error('config: "color" must be "auto", "always", or "never"');
  }
  // dateFormat is any string: a named style (readable/iso/friendly/compact) or a
  // custom moment/dayjs pattern (e.g. "YYYY-MM-DD HH:mm"). No enum check.
  return cfg;
}

/** Load config from disk. Missing file → built-in defaults (empty object).
 *  A present-but-unreadable/malformed file throws (caller warns + falls back). */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): MacmailConfig {
  const path = configPath(env, home);
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return {}; // no file (or unreadable) → defaults
  }
  return parseConfig(text);
}

/** Load config, but never throw: on a malformed file, warn to stderr and use
 *  built-in defaults. Used at CLI startup so a bad file can't brick the tool. */
export function loadConfigOrWarn(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): MacmailConfig {
  try {
    return loadConfig(env, home);
  } catch (e) {
    process.stderr.write(
      `macmail: ignoring ${configPath(env, home)} — ${(e as Error).message}\n`,
    );
    return {};
  }
}
