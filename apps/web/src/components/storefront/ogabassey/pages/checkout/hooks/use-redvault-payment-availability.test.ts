import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRedvaultPaymentAvailability } from './use-redvault-payment-availability';

const merchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
afterEach(() => vi.unstubAllGlobals());
describe('REDVAULT availability', () => {
  it('hides immediately when the merchant changes', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ available: true, reason: 'reviewed' })
      );
    vi.stubGlobal('fetch', request);
    const { result, rerender } = renderHook(
      ({ id }) => useRedvaultPaymentAvailability(id),
      { initialProps: { id: merchant } }
    );
    await waitFor(() => expect(result.current.available).toBe(true));
    rerender({ id: 'other' });
    expect(result.current.available).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
  it.each([
    'network',
    'http',
    'malformed',
    'disabled',
  ])('hides on %s failure', async (failure) => {
    const request = vi.fn().mockImplementation(async () => {
      if (failure === 'network') throw new Error('offline');
      return Response.json(
        failure === 'malformed'
          ? {}
          : { available: failure !== 'disabled', reason: 'gate' },
        { status: failure === 'http' ? 503 : 200 }
      );
    });
    vi.stubGlobal('fetch', request);
    const { result } = renderHook(() =>
      useRedvaultPaymentAvailability(merchant)
    );
    await act(async () => {});
    expect(result.current.available).toBe(false);
  });
  it('aborts the request on unmount and ignores its late result', async () => {
    let complete: (response: Response) => void = () => {};
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', request);
    const { unmount } = renderHook(() =>
      useRedvaultPaymentAvailability(merchant)
    );
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      complete(Response.json({ available: true, reason: 'reviewed' }));
    });
  });
});
