import type { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

/** The parts of a TTY read stream the hidden prompt needs. */
export interface PromptInput extends EventEmitter {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

export interface PromptOutput {
  write: (text: string) => unknown;
}

const ENTER = new Set(['\r', '\n']);
const BACKSPACE = new Set(['\u007f', '\b']);
const CANCEL = new Set(['\u0003', '\u0004']);

/**
 * Asks for a secret on an interactive terminal with echo off. Nothing typed
 * is ever written back; it is refused when the input is not a terminal, so a
 * password can never be piped in from a file, a variable or another command.
 */
export function createHiddenPrompt(input: PromptInput, output: PromptOutput) {
  return (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const setRawMode = input.setRawMode;
      if (input.isTTY !== true || typeof setRawMode !== 'function') {
        reject(new Error('A hidden prompt needs an interactive terminal'));
        return;
      }
      const wasRaw = input.isRaw === true;
      let typed = '';
      const finish = (error?: Error) => {
        input.removeListener('data', onData);
        setRawMode.call(input, wasRaw);
        input.pause();
        output.write('\n');
        if (error) reject(error);
        else resolve(typed);
      };
      const onData = (chunk: Buffer | string) => {
        for (const character of chunk.toString()) {
          if (ENTER.has(character)) return finish();
          if (CANCEL.has(character)) {
            typed = '';
            return finish(new Error('Cancelled'));
          }
          if (BACKSPACE.has(character)) typed = typed.slice(0, -1);
          else typed += character;
        }
      };
      output.write(question);
      setRawMode.call(input, true);
      input.on('data', onData);
      input.resume();
    });
}

/** Asks for one visible line (used for retyping the amount). */
export function createLinePrompt(input: Readable, output: Writable) {
  return async (question: string): Promise<string> => {
    const lines = createInterface({ input, output, terminal: false });
    try {
      return await lines.question(question);
    } finally {
      lines.close();
    }
  };
}
