import { describe, expect, it } from 'vitest';
import { encodeAssistanceFrame } from './encode-assistance-frame';

describe('encode-assistance-frame', () => {
  it('emits a newline-terminated validated JSON frame', () => {
    const line = encodeAssistanceFrame({
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'done' },
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'done' },
    });
  });
});
