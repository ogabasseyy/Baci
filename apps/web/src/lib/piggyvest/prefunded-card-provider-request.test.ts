import { expect, it, vi } from 'vitest';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

it('cancels an unbounded response stream as soon as it exceeds the byte cap', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1025));
    },
    cancel,
  });

  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 100,
      maxResponseBytes: 1024,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(new Response(body, { status: 200 })),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_RESPONSE_TOO_LARGE');
  expect(cancel).toHaveBeenCalled();
});

it('aborts a provider request at the configured timeout', async () => {
  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 1,
      maxResponseBytes: 1024,
      fetchImplementation: vi.fn(() => new Promise<Response>(() => undefined)),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_TIMEOUT');
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
  const outcome = await Promise.race([
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
  if (assertionGuard !== undefined) clearTimeout(assertionGuard);

  // Release the test stream after recording whether the caller timed out
  // independently of cleanup, and exercise rejection observation on cleanup.
  rejectCancellation?.(new Error('late body cancellation rejection'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(outcome).toBe('PROVIDER_TIMEOUT');
  expect(signal?.aborted).toBe(true);
  expect(transportAborted).toBe(true);
  expect(cancellationRequested).toBe(true);
});

it('attaches the bounded HTTP error body for definitive-rejection detection', async () => {
  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/initialize',
      token: 'sk_test_example',
      timeoutMs: 100,
      maxResponseBytes: 1024,
      fetchImplementation: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: false,
            message: 'Duplicate Transaction Reference',
          }),
          { status: 400 }
        )
      ),
      init: { method: 'POST' },
    })
  ).rejects.toMatchObject({
    message: 'PROVIDER_HTTP_ERROR',
    httpStatus: 400,
    responseBody: { status: false, message: 'Duplicate Transaction Reference' },
  });
});

it('rejects a redirected response', async () => {
  const response = new Response(JSON.stringify({ status: true }), {
    status: 200,
  });
  Object.defineProperty(response, 'redirected', { value: true });

  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 100,
      maxResponseBytes: 1024,
      fetchImplementation: vi.fn().mockResolvedValue(response),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_HTTP_ERROR');
});
