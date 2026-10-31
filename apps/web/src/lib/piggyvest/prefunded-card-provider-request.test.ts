import { describe, expect, it, vi } from 'vitest';
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

function signalCapturingFetch(response: Response) {
  const signals: AbortSignal[] = [];
  const fetchImplementation = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return response;
    }
  );
  return { fetchImplementation, signals };
}

function requestWith(
  fetchImplementation: typeof fetch,
  options: { timeoutMs?: number; maxResponseBytes?: number } = {}
) {
  return requestPrefundedCardProviderJson({
    url: 'https://staging.piggyvest.business/api/v1/transaction/verify',
    token: 'synthetic-token',
    timeoutMs: options.timeoutMs ?? 1000,
    maxResponseBytes: options.maxResponseBytes ?? 1024,
    fetchImplementation,
    init: { method: 'GET' },
  });
}

// Settles with whichever comes first, so a request that never returns
// fails the test instead of hanging it.
async function settleWithin<T>(promise: Promise<T>, ms: number) {
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error('STILL_PENDING')), ms);
      }),
    ]);
  } finally {
    clearTimeout(guard);
  }
}

describe('provider request abort fence', () => {
  it('aborts the request when a streamed body passes the byte cap', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
    });
    const { fetchImplementation, signals } = signalCapturingFetch(
      new Response(body, { status: 200 })
    );

    await expect(requestWith(fetchImplementation)).rejects.toThrow(
      'PROVIDER_RESPONSE_TOO_LARGE'
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts the request when the declared length passes the byte cap', async () => {
    const { fetchImplementation, signals } = signalCapturingFetch(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': '4096' },
      })
    );

    await expect(requestWith(fetchImplementation)).rejects.toThrow(
      'PROVIDER_RESPONSE_TOO_LARGE'
    );
    expect(signals[0]?.aborted).toBe(true);
  });

  it('returns at the byte cap even when the body ignores cancellation', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel: () => new Promise<void>(() => undefined),
    });
    const { fetchImplementation, signals } = signalCapturingFetch(
      new Response(body, { status: 200 })
    );

    await expect(
      settleWithin(requestWith(fetchImplementation), 1000)
    ).rejects.toThrow('PROVIDER_RESPONSE_TOO_LARGE');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('returns at the deadline even when a stalled body ignores cancellation', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => new Promise<void>(() => undefined),
    });
    const { fetchImplementation, signals } = signalCapturingFetch(
      new Response(body, { status: 200 })
    );

    await expect(
      settleWithin(requestWith(fetchImplementation, { timeoutMs: 1 }), 1000)
    ).rejects.toThrow('PROVIDER_TIMEOUT');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts the request when an error body passes the byte cap', async () => {
    const { fetchImplementation, signals } = signalCapturingFetch(
      new Response(JSON.stringify({ message: 'x'.repeat(2048) }), {
        status: 404,
      })
    );

    await expect(requestWith(fetchImplementation)).rejects.toMatchObject({
      message: 'PROVIDER_HTTP_ERROR',
      httpStatus: 404,
      responseBody: undefined,
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('leaves a fully read body to finish normally', async () => {
    const { fetchImplementation } = signalCapturingFetch(
      new Response(JSON.stringify({ status: true }), { status: 200 })
    );

    await expect(requestWith(fetchImplementation)).resolves.toEqual({
      status: true,
    });
  });
});
