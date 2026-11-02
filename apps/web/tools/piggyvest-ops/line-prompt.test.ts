import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLinePrompt } from './line-prompt';

describe('createLinePrompt', () => {
  it('returns one typed line', async () => {
    const input = new PassThrough();
    const out = new PassThrough();
    const answer = createLinePrompt(input, out)('Amount: ');
    input.write('15,000.00\n');
    await expect(answer).resolves.toBe('15,000.00');
  });

  it('stops instead of hanging when the input ends before an answer', async () => {
    const input = new PassThrough();
    const answer = createLinePrompt(input, new PassThrough())('Amount: ');
    input.end();
    await expect(answer).rejects.toThrow('Input closed');
  });
});
