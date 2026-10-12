import { describe, expect, it, vi } from 'vitest';
import { readPiggyvestPolicyClientBody as read } from './piggyvest-policy-client-body';

const uninterrupted = new Promise<never>(() => undefined);
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { 'content-type': 'application/json', ...headers } }
  );
}
describe('bounded policy body', () => {
  it('decodes UTF8 across chunk boundaries without native TextDecoder', async () => {
    await expect(
      read(
        streamed([new Uint8Array([34, 0xc3]), new Uint8Array([0xa9, 34])]),
        uninterrupted
      )
    ).resolves.toBe('é');
  });
  it.each([
    streamed([new Uint8Array(262145)]),
    streamed([new Uint8Array([34, 0xff, 34])]),
    streamed([new Uint8Array([123, 125])], { 'content-length': '3' }),
    streamed([], { 'content-length': '262145' }),
    streamed([], { 'content-type': 'text/html' }),
    streamed([], { 'content-encoding': 'gzip' }),
    streamed(Array.from({ length: 1025 }, () => new Uint8Array())),
  ])('rejects oversized, malformed, encoded or unbounded bodies', async (response) => {
    await expect(read(response, uninterrupted)).rejects.toThrow();
  });
  it('cancels a pending body on interruption', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(
      read(response, Promise.reject(new Error('interrupted')))
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });
});
