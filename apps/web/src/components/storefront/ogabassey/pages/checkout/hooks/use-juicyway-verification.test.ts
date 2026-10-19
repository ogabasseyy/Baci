import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJuicywayVerification } from './use-juicyway-verification';

const fetchMock = vi.fn();

function statusResponse(body: Record<string, unknown>) {
  return { ok: true, json: async () => body };
}

describe('useJuicywayVerification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('recovers when the initial status request hangs and confirms on a later poll', async () => {
    // The initial request never resolves on its own; the per-request
    // deadline must abort it so the attempt proceeds to interval polling
    // instead of stalling in the verifying state forever.
    fetchMock
      .mockImplementationOnce(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            );
          })
      )
      .mockResolvedValue(statusResponse({ is_confirmed: true }));

    const onConfirmed = vi.fn();
    const onTerminalFailure = vi.fn();
    const { result } = renderHook(() =>
      useJuicywayVerification({
        target: { paymentId: 'pay-1', sessionId: null },
        onConfirmed,
        onTerminalFailure,
      })
    );

    let verifyPromise: Promise<void> | null = null;
    act(() => {
      verifyPromise = result.current.verify();
    });
    expect(result.current.isVerifying).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/payments/status?gateway=juicyway'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    // The hung initial request hits its deadline and resolves as pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await verifyPromise;
    });
    expect(result.current.status).toBe('pending');
    expect(result.current.isVerifying).toBe(true);

    // The next poll confirms the deposit.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.status).toBe('confirmed');
    expect(result.current.isVerifying).toBe(false);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onTerminalFailure).not.toHaveBeenCalled();
  });
});
