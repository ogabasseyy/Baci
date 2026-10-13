import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/checkout-shipping-recovery', () => ({
  requestCheckoutShippingRecovery: api,
}));

import { useCheckoutShippingRecovery } from './useCheckoutShippingRecovery';

const draft = {
  address: 'Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08012345678',
  latitude: '6.5',
  longitude: '3.3',
};
const preview = {
  previewId: 'p',
  canConfirm: true,
  paidShippingFee: 100,
  quote: {
    id: 'q',
    price: 100,
    displayName: 'GIG',
    estimatedDays: 2,
    expiresAt: '2099-01-01T00:00:00Z',
  },
};
function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children
  );
}
describe('useCheckoutShippingRecovery', () => {
  beforeEach(() => api.mockReset());
  it('never previews on mount and rejects incomplete pins', async () => {
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', { ...draft, latitude: '' }),
      { wrapper }
    );
    expect(api).not.toHaveBeenCalled();
    await act(() => result.current.requestPreview());
    expect(api).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/complete valid/);
  });
  it('previews then confirms separately and clears preview after editing', async () => {
    api
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ confirmed: true, quoteId: 'q' });
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', draft),
      { wrapper }
    );
    await act(() => result.current.requestPreview());
    expect(api).toHaveBeenCalledTimes(1);
    await act(() => result.current.confirm());
    expect(api).toHaveBeenLastCalledWith('o', {
      action: 'confirm',
      previewId: 'p',
      confirmDestination: true,
    });
    expect(result.current.confirmed).toBe(true);
    act(() => result.current.update({ city: 'Lekki' }));
    expect(result.current.preview).toBeNull();
    expect(result.current.confirmed).toBe(false);
  });
  it('discards a stale preview response after a destination edit', async () => {
    let finish!: (value: typeof preview) => void;
    api.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', draft),
      { wrapper }
    );
    let request!: Promise<void>;
    act(() => {
      request = result.current.requestPreview();
    });
    act(() => result.current.update({ latitude: '6.6' }));
    await act(async () => {
      finish(preview);
      await request;
    });
    expect(result.current.preview).toBeNull();
  });
  it('refuses changed prices and guards duplicate in-flight confirmation', async () => {
    api.mockResolvedValueOnce({
      ...preview,
      canConfirm: false,
      previewId: null,
    });
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', draft),
      { wrapper }
    );
    await act(() => result.current.requestPreview());
    await act(() => result.current.confirm());
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValueOnce(preview);
    await act(() => result.current.requestPreview());
    let finish!: () => void;
    api.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ confirmed: true, quoteId: 'q' });
      })
    );
    let request!: Promise<void>;
    act(() => {
      request = result.current.confirm();
    });
    await act(() => result.current.confirm());
    expect(api).toHaveBeenCalledTimes(3);
    await act(async () => {
      finish();
      await request;
    });
  });
  it('clears stale preview after confirmation errors', async () => {
    api
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error('Destination changed. Preview again.'));
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', draft),
      { wrapper }
    );
    await act(() => result.current.requestPreview());
    await act(() => result.current.confirm());
    expect(result.current.preview).toBeNull();
    expect(result.current.error).toMatch(/changed/);
  });
  it('rejects an expired preview and a mismatched paid amount even if confirmation is advertised', async () => {
    api.mockResolvedValueOnce({
      ...preview,
      quote: { ...preview.quote, expiresAt: '2000-01-01T00:00:00Z' },
    });
    const { result } = renderHook(
      () => useCheckoutShippingRecovery('o', draft),
      { wrapper }
    );
    await act(() => result.current.requestPreview());
    await act(() => result.current.confirm());
    expect(result.current.error).toMatch(/expired/);
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValueOnce({ ...preview, paidShippingFee: 90 });
    await act(() => result.current.requestPreview());
    await act(() => result.current.confirm());
    expect(result.current.error).toMatch(/differs/);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
