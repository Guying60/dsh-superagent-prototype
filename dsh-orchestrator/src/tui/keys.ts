/**
 * Raw-key reader for the terminal UI (zero dependencies, no readline).
 */
import { stdin } from 'node:process';

export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'space'
  | 'interrupt'
  | 'char';

export interface Key {
  name: KeyName;
  char?: string;
  ctrl?: boolean;
}

const ESC = '\u001b';

export class KeyReader {
  private buffer = '';
  private started = false;
  private escaping?: NodeJS.Timeout;

  constructor(private readonly onKey: (key: Key) => void) {}

  public start(): void {
    if (this.started) return;
    this.started = true;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', this.handleData);
  }

  public stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.escaping) clearTimeout(this.escaping);
    stdin.off('data', this.handleData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }

  private handleData = (chunk: string): void => {
    this.buffer += chunk;
    this.drain();
  };

  private drain(): void {
    while (this.buffer.length > 0) {
      const seq = this.matchSequence();
      if (seq === null) return; // incomplete escape sequence: wait for more bytes
      if (seq === false) {
        // a lone ESC could be the start of a sequence or an actual escape press
        const esc = this.buffer[0];
        this.buffer = this.buffer.slice(1);
        this.emitEscapeOrChar(esc);
        continue;
      }
      this.buffer = this.buffer.slice(seq.length);
      this.onKey(seq.key);
    }
  }

  /** null = need more data, false = not an escape sequence (treat as char), object = matched */
  private matchSequence(): { length: number; key: Key } | false | null {
    const b = this.buffer;

    if (b[0] !== ESC) {
      const ch = b[0];
      if (ch === '\r' || ch === '\n') return { length: 1, key: { name: 'enter' } };
      if (ch === '\t') return { length: 1, key: { name: 'tab' } };
      if (ch === '\u007f' || ch === '\b') return { length: 1, key: { name: 'backspace' } };
      if (ch === '\u0003') return { length: 1, key: { name: 'interrupt' } };
      if (ch === ' ') return { length: 1, key: { name: 'space', char: ' ' } };
      return { length: 1, key: { name: 'char', char: ch } };
    }

    if (b.length === 1) {
      // wait very briefly: if nothing follows it was a plain ESC
      if (!this.escaping) {
        this.escaping = setTimeout(() => {
          this.escaping = undefined;
          if (this.buffer === ESC) {
            this.buffer = '';
            this.onKey({ name: 'escape' });
          }
        }, 30);
      }
      return null;
    }

    const simple: Record<string, KeyName> = {
      [`${ESC}[A`]: 'up',
      [`${ESC}[B`]: 'down',
      [`${ESC}[C`]: 'right',
      [`${ESC}[D`]: 'left'
    };

    for (const [seq, name] of Object.entries(simple)) {
      if (b.startsWith(seq)) return { length: seq.length, key: { name } };
    }

    // generic CSI / SS3 sequences: consume them and ignore
    const csi = b.match(/^\u001b\[[0-9;]*[A-Za-z~]/);
    if (csi) {
      const map: Record<string, KeyName> = { '\u001b[A': 'up', '\u001b[B': 'down', '\u001b[C': 'right', '\u001b[D': 'left' };
      const mapped = map[csi[0]];
      return mapped
        ? { length: csi[0].length, key: { name: mapped } }
        : { length: csi[0].length, key: { name: 'escape' } };
    }

    const ss3 = b.match(/^\u001bO[A-Za-z]/);
    if (ss3) {
      const map: Record<string, KeyName> = { '\u001bOA': 'up', '\u001bOB': 'down', '\u001bOC': 'right', '\u001bOD': 'left' };
      return { length: ss3[0].length, key: { name: map[ss3[0]] ?? 'escape' } };
    }

    if (b.length < 6 && b[0] === ESC) return null;
    return false;
  }

  private emitEscapeOrChar(ch: string): void {
    if (ch === ESC) {
      this.onKey({ name: 'escape' });
      return;
    }
    this.onKey({ name: 'char', char: ch });
  }
}
