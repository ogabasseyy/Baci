import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCheckoutResumeLifecycle } from './use-checkout-resume-lifecycle';

const executeResumedDirectPayment = vi.hoisted(() => vi.fn());
vi.mock('../handlers/direct-payment', () => ({
  executeResumedDirectPayment,
}));

const baseOptions = () => ({
  resumeOrderId: 'order-1',
  resumeTrackingToken: 'token-1',
  resumeLookupEmail: null,
  resumeMerchantSlug: 'ogabassey',
  preferredGateway: 'credpal' as const,
  isHydrated: true,
  hasCheckoutCartItems: false,
  setCheckoutFields: vi.fn(),
  merchantSlug: 'ogabassey',
  merchantChargeCurrency: 'NGN',
  isProcessing: false,
  setIsProcessing: vi.fn(),
  clearCheckoutSession: vi.fn(),
  routerPush: vi.fn(),
  getHref: (path: string) => `/ogabassey${path}`,
});

afterEach(() => {
  vi.unstubAllGlobals();
  executeResumedDirectPayment.mockClear();
});

it('loads and hydrates the resumed order, then auto-dispatches direct payment once', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 'order-1',
        total: 11_500,
        customer_name: 'Ada Okon',
        customer_email: 'ada@example.test',
        items: [],
      })
    )
  );
  vi.stubGlobal('fetch', fetchMock);
  const options = baseOptions();
  const { result, rerender } = renderHook(
    (props) => useCheckoutResumeLifecycle(props),
    { initialProps: options }
  );

  await waitFor(() => expect(result.current.resumedOrder?.id).toBe('order-1'));
  await waitFor(() =>
    expect(executeResumedDirectPayment).toHaveBeenCalledOnce()
  );
  expect(options.setCheckoutFields).toHaveBeenCalledWith(
    expect.objectContaining({ customerEmail: 'ada@example.test' })
  );
  expect(executeResumedDirectPayment).toHaveBeenCalledWith(
    expect.objectContaining({
      resumedOrder: expect.objectContaining({ total: 11_500 }),
      preferredGateway: 'credpal',
    })
  );

  rerender({ ...options, isProcessing: false });
  expect(executeResumedDirectPayment).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('waits for hydration and gives an active cart precedence over resume lookup', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const options = baseOptions();
  const { rerender } = renderHook(
    (props) => useCheckoutResumeLifecycle(props),
    { initialProps: { ...options, isHydrated: false } }
  );

  rerender({ ...options, isHydrated: true, hasCheckoutCartItems: true });
  expect(fetchMock).not.toHaveBeenCalled();
  rerender({ ...options, isHydrated: true, hasCheckoutCartItems: false });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
});

it('surfaces a failed resume lookup without dispatching payment', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
  );
  const { result } = renderHook(() =>
    useCheckoutResumeLifecycle(baseOptions())
  );

  await waitFor(() =>
    expect(result.current.resumeOrderError).toMatch(/not found/i)
  );
  expect(result.current.resumedOrder).toBeNull();
  expect(executeResumedDirectPayment).not.toHaveBeenCalled();
});

it('aborts stale resume requests when the order identity changes', async () => {
  let resolveStale: (response: Response) => void = () => undefined;
  const staleResponse = new Promise<Response>((resolve) => {
    resolveStale = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(staleResponse)
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'order-2', total: 1 }))
    );
  vi.stubGlobal('fetch', fetchMock);
  const options = baseOptions();
  const { rerender } = renderHook(
    (props) => useCheckoutResumeLifecycle(props),
    { initialProps: options }
  );
  const staleSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;

  rerender({ ...options, resumeOrderId: 'order-2' });
  expect(staleSignal.aborted).toBe(true);
  await waitFor(() =>
    expect(executeResumedDirectPayment).toHaveBeenCalledOnce()
  );
  resolveStale(new Response(JSON.stringify({ id: 'order-1', total: 2 })));
  expect(executeResumedDirectPayment.mock.calls[0]?.[0].resumedOrder?.id).toBe(
    'order-2'
  );
});
