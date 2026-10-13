import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStorefrontPdpSemanticRpc } from './storefront-pdp-semantic-rpc';

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

type AbortableQueryMock<T> = PromiseLike<T> & {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

function createAbortableQuery<T>(
  response: T,
  abortSignal: AbortableQueryMock<T>['abortSignal']
): AbortableQueryMock<T> {
  const promise = new Promise<T>((resolve) => resolve(response));
  return Object.assign(promise, { abortSignal });
}

function createPendingAbortableQuery<T>(
  abortSignal: AbortableQueryMock<T>['abortSignal']
): AbortableQueryMock<T> {
  const promise = new Promise<T>(() => undefined);
  return Object.assign(promise, { abortSignal });
}

describe('runStorefrontPdpSemanticRpc', () => {
  beforeEach(() => {
    loggerMocks.warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks an aborted request at the client boundary without logging query inputs', async () => {
    const timeoutController = new AbortController();
    const timeoutError = new DOMException(
      'The operation timed out',
      'TimeoutError'
    );
    timeoutController.abort(timeoutError);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const abortSignal = vi.fn<(signal: AbortSignal) => PromiseLike<void>>(() =>
      Promise.reject(timeoutError)
    );
    const merchantSentinel = 'merchant-sensitive-sentinel';
    const productSentinel = 'product-sensitive-sentinel';
    const query = Object.assign(
      createAbortableQuery<void>(undefined, abortSignal),
      { merchantId: merchantSentinel, productId: productSentinel }
    );

    await expect(
      runStorefrontPdpSemanticRpc(query, {
        deadlineMs: 5_000,
        traceThresholdMs: 4_000,
      })
    ).rejects.toBe(timeoutError);

    expect(abortSignal).toHaveBeenCalledWith(timeoutController.signal);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'throw',
        deadlineMs: 5_000,
        timeoutSignalAborted: true,
        errorName: 'TimeoutError',
      })
    );
    const serializedWarning = JSON.stringify(
      loggerMocks.warn.mock.calls[0]?.[0]
    );
    expect(serializedWarning).not.toContain(merchantSentinel);
    expect(serializedWarning).not.toContain(productSentinel);
  });

  it('traces a slow successful response without changing its value', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      new AbortController().signal
    );
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(4_001);
    const response = { data: [], error: null, status: 200 };
    const abortSignal = vi.fn<
      (signal: AbortSignal) => PromiseLike<typeof response>
    >(() => Promise.resolve(response));
    const query = createAbortableQuery(response, abortSignal);

    await expect(
      runStorefrontPdpSemanticRpc(query, {
        deadlineMs: 5_000,
        traceThresholdMs: 4_000,
      })
    ).resolves.toMatchObject({ response });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'slow_response',
        responseStatus: 200,
        elapsedMs: 4_001,
      })
    );
  });

  it('returns at the deadline when an aborted RPC promise never settles', async () => {
    const timeoutController = new AbortController();
    const timeoutError = new DOMException(
      'The operation timed out',
      'TimeoutError'
    );
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const abortSignal = vi.fn<(signal: AbortSignal) => PromiseLike<never>>(
      () => new Promise<never>(() => undefined)
    );
    const query = createPendingAbortableQuery<never>(abortSignal);
    const result = runStorefrontPdpSemanticRpc(query, {
      deadlineMs: 5_000,
      traceThresholdMs: 4_000,
    });

    timeoutController.abort(timeoutError);

    await expect(result).rejects.toBe(timeoutError);
    expect(abortSignal).toHaveBeenCalledWith(timeoutController.signal);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'throw',
        errorName: 'TimeoutError',
        timeoutSignalAborted: true,
      })
    );
  });
});
