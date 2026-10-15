import { describe, expect, it } from 'vitest';
import { readBoundedBody } from './merchant-image-pilot-preflight-served-body.mjs';

function fakeResponse(chunks) {
  const queue = chunks.map((chunk) => Buffer.from(chunk));
  let cancelled = false;
  let released = false;
  const reader = {
    cancel: () => {
      cancelled = true;
      return Promise.resolve();
    },
    read: () => {
      const value = queue.shift();
      if (value === undefined) {
        return Promise.resolve({ done: true, value: undefined });
      }
      return Promise.resolve({ done: false, value });
    },
    releaseLock: () => {
      released = true;
    },
  };
  return {
    body: { getReader: () => reader },
    state: () => ({ cancelled, released }),
  };
}

describe('readBoundedBody', () => {
  it('returns empty bytes for a bodiless response', async () => {
    await expect(readBoundedBody({}, 10)).resolves.toEqual({
      bytes: Buffer.alloc(0),
      truncated: false,
    });
    await expect(readBoundedBody({ body: null }, 10)).resolves.toEqual({
      bytes: Buffer.alloc(0),
      truncated: false,
    });
  });

  it('streams bodies within the cap and releases the reader', async () => {
    const { body, state } = fakeResponse(['ab', 'cd']);
    const result = await readBoundedBody({ body }, 4);
    expect(result.truncated).toBe(false);
    expect(result.bytes).toEqual(Buffer.from('abcd'));
    expect(state().released).toBe(true);
    expect(state().cancelled).toBe(true);
  });

  it('rejects overflow with truncation instead of buffering', async () => {
    const { body } = fakeResponse(['abcd', 'ef']);
    const result = await readBoundedBody({ body }, 4);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toEqual(Buffer.alloc(0));
  });
});
