import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

/**
 * Asks for one visible line (used for retyping the amount). Stops with
 * "Input closed" if the input ends before a line is typed.
 */
export function createLinePrompt(input: Readable, output: Writable) {
  return async (question: string): Promise<string> => {
    const lines = createInterface({ input, output, terminal: false });
    const closed = new AbortController();
    const onClosed = () => closed.abort();
    lines.once('close', onClosed);
    input.once('error', onClosed);
    try {
      return await lines.question(question, { signal: closed.signal });
    } catch (error) {
      if (closed.signal.aborted) throw new Error('Input closed');
      throw error;
    } finally {
      lines.removeListener('close', onClosed);
      input.removeListener('error', onClosed);
      lines.close();
    }
  };
}
