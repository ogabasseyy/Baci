import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerCancelHandler } from './customer-cancel-handler';

vi.mock('server-only', () => ({}));
const goalId = 'abcdefab-4444-4444-8444-444444444444';
function fixture(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  signal = new AbortController().signal
) {
  const from = vi.fn();
  const execute = vi.fn();
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: goalId } }, error: null });
  const handler = createPiggyvestCustomerCancelHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {},
    execute,
    checkCsrfProtection: vi.fn().mockReturnValue({ valid: true }),
  });
  const request = {
    method: 'POST',
    url: 'https://synthetic.test/cancel',
    body,
    signal,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
  } as unknown as NextRequest;
  return { response: handler.POST(request), from, execute };
}
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
afterEach(() => vi.useRealTimers());
it.each<Record<string, string>>([
  { 'content-type': 'text/plain' },
  { 'content-type': 'application/json; charset=latin1' },
  { 'content-encoding': 'gzip' },
  { 'content-length': '-1' },
  { 'content-length': '2e3' },
  { 'content-length': '4097' },
  { 'content-length': '3' },
])('rejects malformed headers before database access %j', async (headers) => {
  const test = fixture(stream([new TextEncoder().encode('{}')]), headers);
  expect((await test.response).status).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});
it.each([
  { chunks: [new Uint8Array([255])] },
  { chunks: [new Uint8Array(4097)] },
  { chunks: Array.from({ length: 65 }, () => new Uint8Array()) },
])('rejects invalid UTF8, oversized or excessive chunks', async ({
  chunks,
}) => {
  const test = fixture(stream(chunks));
  expect((await test.response).status).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
});
it('bounds stalled readers even when cancellation never resolves', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const test = fixture(
    new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel,
    })
  );
  await vi.advanceTimersByTimeAsync(2001);
  expect((await test.response).status).toBe(400);
  expect(cancel).toHaveBeenCalledOnce();
  expect(test.from).not.toHaveBeenCalled();
});
it('rejects abort without performing database operations', async () => {
  const controller = new AbortController();
  const test = fixture(new ReadableStream<Uint8Array>(), {}, controller.signal);
  controller.abort();
  expect((await test.response).status).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
});
