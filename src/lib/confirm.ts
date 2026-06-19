// confirm.ts — y/N prompt that reads from /dev/tty so it works when stdin
// is piped. Mockable for tests via the Confirmer interface.

import { openSync, readSync, closeSync } from 'node:fs';

export interface Confirmer {
  prompt(message: string): Promise<boolean>;
}

export const autoYesConfirmer: Confirmer = {
  async prompt() {
    return true;
  },
};

export const autoNoConfirmer: Confirmer = {
  async prompt() {
    return false;
  },
};

/** Reads y/N from /dev/tty (so stdin piping still gets a chance to confirm). */
export const ttyConfirmer: Confirmer = {
  async prompt(message: string): Promise<boolean> {
    process.stderr.write(`${message} [y/N] `);
    let fd: number;
    try {
      fd = openSync('/dev/tty', 'r');
    } catch {
      return false; // no tty available, treat as "no"
    }
    try {
      const buf = Buffer.alloc(64);
      const n = readSync(fd, buf, 0, buf.length, null);
      const answer = buf.toString('utf-8', 0, n).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    } finally {
      closeSync(fd);
    }
  },
};
