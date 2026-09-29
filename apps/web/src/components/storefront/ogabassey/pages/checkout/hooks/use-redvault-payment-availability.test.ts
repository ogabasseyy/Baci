import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRedvaultPaymentAvailability } from './use-redvault-payment-availability';

const merchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const product = '11111111-1111-4111-8111-111111111111';
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
  it('hides stale pilot availability while the cart product changes', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({ available: true, reason: 'private_live_pilot' })
    );
    vi.stubGlobal('fetch', request);
    const { result, rerender } = renderHook(
      ({ productId }: { productId: string | undefined }) =>
        useRedvaultPaymentAvailability(merchant, productId),
      { initialProps: { productId: product as string | undefined } }
    );
    await waitFor(() => expect(result.current.available).toBe(true));
    rerender({ productId: undefined });
    expect(result.current.available).toBe(false);
    expect(request).toHaveBeenLastCalledWith(
      expect.stringContaining(`merchant_id=${merchant}`),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
  it('hides prior pilot visibility when auth revision changes while status stays authenticated', async () => {
    let resolveSecondRequest: ((response: Response) => void) | undefined;
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ available: true, reason: 'private_live_pilot' })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecondRequest = resolve;
          })
      );
    vi.stubGlobal('fetch', request);
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) =>
        useRedvaultPaymentAvailability(
          merchant,
          product,
          `authenticated:${revision}`
        ),
      { initialProps: { revision: 1 } }
    );

    await waitFor(() => expect(result.current.available).toBe(true));
    rerender({ revision: 2 });
    expect(result.current.available).toBe(false);

    await act(async () => {
      resolveSecondRequest?.(
        Response.json({ available: true, reason: 'private_live_pilot' })
      );
    });
    await waitFor(() => expect(result.current.available).toBe(true));
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
