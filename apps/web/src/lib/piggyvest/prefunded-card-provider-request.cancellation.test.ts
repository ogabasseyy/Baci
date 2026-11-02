import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

it('returns at the deadline when a stalled response body cancel never settles', async () => {
  let rejectCancellation: ((reason: Error) => void) | undefined;
  let cancellationRequested = false;
  let signal: AbortSignal | undefined;
  let transportAborted = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancellationRequested = true;
      return new Promise<void>((_resolve, reject) => {
        rejectCancellation = reject;
      });
    },
  });
  const fetchImplementation = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        transportAborted = true;
      });
      return new Response(body, { status: 200 });
    }
  );
  const request = requestPrefundedCardProviderJson({
    url: 'https://api.piggyvest.business/api/v1/transaction',
    token: 'test-provider-token',
    timeoutMs: 10,
    maxResponseBytes: 1024,
    fetchImplementation,
    init: { method: 'GET' },
  });

  // Bound the assertion itself so this regression fails promptly if cleanup
  // starts blocking the timeout again.
  let assertionGuard: ReturnType<typeof setTimeout> | undefined;
  const outcomePromise = Promise.race([
    request.then(
      () => 'resolved',
      (error: unknown) =>
        error instanceof Error ? error.message : 'unknown rejection'
    ),
    new Promise<string>((resolve) => {
      assertionGuard = setTimeout(
        () => resolve('still pending after deadline'),
        250
      );
    }),
  ]);
  await vi.advanceTimersByTimeAsync(10);
  const outcome = await outcomePromise;
  if (assertionGuard !== undefined) clearTimeout(assertionGuard);

  // Release the test stream after recording whether the caller timed out
  // independently of cleanup, and exercise rejection observation on cleanup.
  rejectCancellation?.(new Error('late body cancellation rejection'));
  await vi.advanceTimersByTimeAsync(0);

  expect(outcome).toBe('PROVIDER_TIMEOUT');
  expect(signal?.aborted).toBe(true);
  expect(transportAborted).toBe(true);
  expect(cancellationRequested).toBe(true);
});
