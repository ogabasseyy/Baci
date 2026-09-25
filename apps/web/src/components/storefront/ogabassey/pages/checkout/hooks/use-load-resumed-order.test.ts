import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLoadResumedOrder } from './use-load-resumed-order';

const callbacks = () => ({
  setIsLoadingResumedOrder: vi.fn(),
  setResumedOrder: vi.fn(),
  setCheckoutFields: vi.fn(),
  setPaymentTab: vi.fn(),
  setPaymentMethod: vi.fn(),
  setResumeOrderError: vi.fn(),
});
const identity = {
  resumeOrderId: 'first-order',
  resumeMerchantSlug: 'ogabassey',
  resumeTrackingToken: 'tracking-token',
  resumeLookupEmail: null,
  preferredGateway: null,
};
afterEach(() => vi.unstubAllGlobals());

it('does not refetch when hydrating the form recreates its callbacks', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'first-order', customer_name: 'Ada Okon' })
      )
    );
  vi.stubGlobal('fetch', fetchMock);
  const first = callbacks();
  const { rerender } = renderHook((props) => useLoadResumedOrder(props), {
    initialProps: { ...identity, ...first },
  });
  await waitFor(() => expect(first.setCheckoutFields).toHaveBeenCalledOnce());
  rerender({ ...identity, ...callbacks() });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('cancels an obsolete load and ignores a response that arrives after cancellation', async () => {
  let resolveOld: (value: Response) => void = () => undefined;
  const old = new Promise<Response>((resolve) => {
    resolveOld = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'second-order' }))
    );
  vi.stubGlobal('fetch', fetchMock);
  const updates = callbacks();
  const { rerender, unmount } = renderHook(
    (props) => useLoadResumedOrder(props),
    { initialProps: { ...identity, ...updates } }
  );
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  rerender({ ...identity, ...updates, resumeOrderId: 'second-order' });
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() =>
    expect(updates.setResumedOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'second-order' })
    )
  );
  await act(async () =>
    resolveOld(new Response(JSON.stringify({ id: 'first-order' })))
  );
  expect(updates.setResumedOrder).toHaveBeenCalledOnce();
  expect(updates.setResumeOrderError).not.toHaveBeenCalledWith(
    expect.any(String)
  );
  unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

it.each([
  'resumeOrderId',
  'resumeMerchantSlug',
] as const)('leaves loading when %s disappears during a request', async (missing) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined))
  );
  const updates = callbacks();
  const initialProps = {
    ...identity,
    ...updates,
    resumeOrderId: 'first-order' as string | null,
    resumeMerchantSlug: 'ogabassey' as string | null,
  };
  const { rerender } = renderHook((props) => useLoadResumedOrder(props), {
    initialProps,
  });
  expect(updates.setIsLoadingResumedOrder).toHaveBeenLastCalledWith(true);
  rerender({ ...initialProps, [missing]: null });
  expect(updates.setIsLoadingResumedOrder).toHaveBeenLastCalledWith(false);
  expect(updates.setResumedOrder).toHaveBeenLastCalledWith(null);
});
