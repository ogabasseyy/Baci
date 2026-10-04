import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';

const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  timeoutMs: 20,
};
const options = {
  configuration,
  path: '/api/v1/wallet/synthetic-wallet',
  method: 'GET' as const,
};

afterEach(() => vi.useRealTimers());

describe('staging JSON response bounds', () => {
  it('rejects non-byte chunks before they can bypass byte accounting', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue('synthetic-private' as unknown as Uint8Array);
        controller.close();
      },
    });
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        fetchImplementation: vi.fn(async () => new Response(body)),
      })
    ).rejects.toMatchObject({ code: 'BODY_READ_ERROR' });
  });

  it('redacts synchronous fetch errors and never retries', async () => {
    const fetchImplementation = vi.fn(() => {
      throw new Error('provider secret');
    });
    const error = await requestPiggyvestStagingJson({
      ...options,
      fetchImplementation,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      message: 'PiggyVest staging request failed: NETWORK_ERROR.',
    });
    expect(error).not.toHaveProperty('cause');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    302, 400, 500,
  ])('discards HTTP %s without awaiting stalled cancellation', async (status) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetchImplementation = vi.fn(
      async () => new Response(new ReadableStream({ cancel }), { status })
    );
    await expect(
      requestPiggyvestStagingJson({ ...options, fetchImplementation })
    ).rejects.toMatchObject({ code: 'HTTP_STATUS' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects redirects even when injected fetch reports HTTP success', async () => {
    const response = Response.json({ status: true });
    Object.defineProperty(response, 'redirected', { value: true });
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        fetchImplementation: vi.fn(async () => response),
      })
    ).rejects.toMatchObject({ code: 'HTTP_STATUS' });
  });

  it('times out ignored aborts and discards late responses', async () => {
    vi.useFakeTimers();
    let deliver: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        })
    );
    const outcome = requestPiggyvestStagingJson({
      ...options,
      fetchImplementation,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toMatchObject({ code: 'TIMEOUT' });
    const cancel = vi.fn();
    deliver?.(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('uses the same deadline for fetch and a stalled body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let deliver: ((response: Response) => void) | undefined;
    const outcome = requestPiggyvestStagingJson({
      ...options,
      fetchImplementation: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            deliver = resolve;
          })
      ),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15);
    deliver?.(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(5);
    expect(await outcome).toMatchObject({ code: 'TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    0, 1,
  ])('bounds endless streams of %s-byte chunks without hanging', async (size) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(size));
      },
      cancel,
    });
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        fetchImplementation: vi.fn(async () => new Response(body)),
      })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('decodes a UTF8 character split across chunks', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of new TextEncoder().encode('"é"'))
          controller.enqueue(Uint8Array.of(value));
        controller.close();
      },
    });
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        fetchImplementation: vi.fn(async () => new Response(body)),
      })
    ).resolves.toBe('é');
  });

  it.each([
    new Uint8Array([34, 0xff, 34]),
    new Uint8Array([34, 0xc3]),
    new TextEncoder().encode('{invalid}'),
  ])('rejects malformed UTF8 or JSON with a generic error', async (bytes) => {
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        fetchImplementation: vi.fn(async () => new Response(bytes)),
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
