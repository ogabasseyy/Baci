import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getFundingAccount: vi.fn(),
  getQuote: vi.fn(),
  getWallet: vi.fn(),
  requestFundingAccount: vi.fn(),
}));

const appState = vi.hoisted(() => ({
  listener: (() => undefined) as (state: string) => void,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: vi.fn() };
    },
  },
}));

vi.mock('@/lib/order-gigl-shipping', () => {
  class TestShippingError extends Error {}
  return {
    getMerchantWalletFundingAccount: api.getFundingAccount,
    getMerchantWalletSummary: api.getWallet,
    getOrRequestMerchantWalletFundingAccount: async () => {
      const account = await api.getFundingAccount();
      return account
        ? { account, status: account.status }
        : api.requestFundingAccount();
    },
    getOrderGiglQuote: api.getQuote,
    OrderGiglShippingError: TestShippingError,
    requestMerchantWalletFundingAccount: api.requestFundingAccount,
  };
});

import { useOrderGiglShipping } from './useOrderGiglShipping';

const result = {
  quote: {
    id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
    provider: 'GIGL' as const,
    serviceTier: 'Express',
    carrierName: 'GIG Logistics',
    displayName: 'Door Delivery',
    estimatedDays: 2,
    price: 11000,
    currency: 'NGN' as const,
    pickupIncluded: true,
    insuranceIncluded: false,
    expiresAt: '2026-09-01T18:00:00.000Z',
  },
  availableBalance: 1000,
  shortfall: 10000,
  canBook: false,
};

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children
  );
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOrderGiglShipping', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
    api.getQuote.mockResolvedValue(result);
    api.getFundingAccount.mockResolvedValue(null);
    appState.listener = () => undefined;
  });

  it('does not request while the sheet method step is closed', () => {
    renderHook(
      () => useOrderGiglShipping({ enabled: false, orderId: 'order-1' }),
      { wrapper }
    );
    expect(api.getQuote).not.toHaveBeenCalled();
  });

  it('requests a quote only when enabled and exposes the shortfall', async () => {
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    expect(hook.current.quote?.price).toBe(11000);
    expect(hook.current.wallet).toMatchObject({
      availableBalance: 1000,
      canBook: false,
      shortfall: 10000,
    });
  });

  it('uses a non-mutating preview request before provider fulfillment is selected', async () => {
    const { result: hook } = renderHook(
      () =>
        useOrderGiglShipping({
          enabled: true,
          orderId: 'order-1',
          preview: true,
        }),
      { wrapper }
    );
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledOnce();
    expect(api.getQuote.mock.calls[0]?.[3]).toBe(true);
    expect(hook.current.quote?.price).toBe(11000);
  });

  it('does not treat an unbound preview quote as confirmation-ready', async () => {
    api.getQuote.mockResolvedValue({
      ...result,
      availableBalance: 11000,
      shortfall: 0,
      canBook: true,
    });
    const { result: hook } = renderHook(
      () =>
        useOrderGiglShipping({
          enabled: true,
          orderId: 'order-1',
          preview: true,
        }),
      { wrapper }
    );
    await flushPromises();
    expect(hook.current.wallet?.canBook).toBe(true);

    let allowed = true;
    await act(async () => {
      allowed = await hook.current.ensureFreshQuoteForConfirmation();
    });
    expect(allowed).toBe(false);
  });

  it('retries with a mutating bind request after provider fulfillment is selected', async () => {
    type Props = { preview: boolean };
    const { rerender } = renderHook(
      ({ preview }: Props) =>
        useOrderGiglShipping({
          enabled: true,
          orderId: 'order-1',
          preview,
        }),
      { initialProps: { preview: true }, wrapper }
    );
    await flushPromises();
    rerender({ preview: false });
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledTimes(2);
    expect(api.getQuote.mock.calls[0]?.[3]).toBe(true);
    expect(api.getQuote.mock.calls[1]).toHaveLength(3);
  });

  it('requotes when only the saved Google coordinates change', async () => {
    type Props = { latitude: number; longitude: number };
    const { rerender } = renderHook(
      ({ latitude, longitude }: Props) =>
        useOrderGiglShipping({
          enabled: true,
          initialAddress: {
            address: '1 Allen Avenue',
            latitude,
            longitude,
            phone: '0801',
          },
          orderId: 'order-1',
        }),
      { initialProps: { latitude: 6.601, longitude: 3.351 }, wrapper }
    );
    await flushPromises();
    rerender({ latitude: 6.602, longitude: 3.352 });
    await flushPromises();

    expect(api.getQuote).toHaveBeenCalledTimes(2);
    expect(api.getQuote.mock.calls[1]?.[1]).toMatchObject({
      latitude: 6.602,
      longitude: 3.352,
    });
  });

  it('renders only server-reported missing fields and retries with completed address', async () => {
    api.getQuote
      .mockRejectedValueOnce({
        code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
        missing: ['city', 'state'],
        message: 'Incomplete',
      })
      .mockResolvedValueOnce(result);
    const { result: hook } = renderHook(
      () =>
        useOrderGiglShipping({
          enabled: true,
          initialAddress: { address: '1 Allen', phone: '0801' },
          orderId: 'order-1',
        }),
      { wrapper }
    );
    await flushPromises();
    expect(hook.current.missingFields).toEqual(['city', 'state']);
    act(() => {
      hook.current.updateAddressField('city', 'Ikeja');
      hook.current.updateAddressField('state', 'Lagos');
    });
    await act(() => hook.current.requestQuote());
    expect(api.getQuote).toHaveBeenLastCalledWith(
      'order-1',
      { address: '1 Allen', city: 'Ikeja', state: 'Lagos', phone: '0801' },
      expect.any(AbortSignal)
    );
  });

  it('requires explicit funding consent and exposes pending then active DVA', async () => {
    api.requestFundingAccount.mockResolvedValueOnce({
      account: null,
      status: 'pending',
    });
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    expect(hook.current.quote).not.toBeNull();
    await act(async () => {
      await hook.current.startFunding();
    });
    expect(api.requestFundingAccount).toHaveBeenCalledOnce();
    expect(hook.current.state).toBe('funding_pending');
  });

  it('refreshes a pending funding account and exposes it when assignment completes', async () => {
    api.requestFundingAccount.mockResolvedValueOnce({
      account: null,
      status: 'pending',
    });
    const account = {
      accountName: 'BACI / Store',
      accountNumber: '1234567890',
      bankName: 'Wema Bank',
      currency: 'NGN' as const,
      status: 'active' as const,
    };
    api.getFundingAccount
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(account);
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    await act(async () => {
      await hook.current.startFunding();
    });
    expect(hook.current.state).toBe('funding_pending');

    await act(async () => {
      await hook.current.refreshFundingAccount();
    });
    expect(api.getFundingAccount).toHaveBeenCalledTimes(2);
    expect(hook.current.fundingAccount).toEqual(account);
    expect(hook.current.state).toBe('ready');
  });

  it('returns null and enters an error state when funding status refresh fails', async () => {
    api.getFundingAccount.mockRejectedValueOnce(
      new Error('funding status unavailable')
    );
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();

    let account: unknown;
    await act(async () => {
      account = await hook.current.refreshFundingAccount();
    });

    expect(account).toBeNull();
    expect(hook.current.state).toBe('error');
    expect(hook.current.error).toBe('funding status unavailable');
  });

  it('deduplicates funding provisioning while consent is in flight', async () => {
    let resolveAccount: (value: null) => void = () => undefined;
    api.getFundingAccount.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveAccount = resolve;
      })
    );
    api.requestFundingAccount.mockResolvedValue({
      account: null,
      status: 'pending',
    });
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.current.startFunding();
      second = hook.current.startFunding();
    });
    expect(api.getFundingAccount).toHaveBeenCalledOnce();
    resolveAccount(null);
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(api.requestFundingAccount).toHaveBeenCalledOnce();
  });

  it('refreshes an expiring quote and requires a second confirmation tap', async () => {
    const funded = {
      ...result,
      availableBalance: 11000,
      shortfall: 0,
      canBook: true,
    };
    api.getQuote.mockResolvedValueOnce(funded).mockResolvedValueOnce({
      ...funded,
      quote: {
        ...funded.quote,
        price: 12000,
        expiresAt: '2026-09-01T19:00:00.000Z',
      },
      availableBalance: 12000,
    });
    vi.setSystemTime('2026-09-01T17:59:45.000Z');
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();

    let allowed = true;
    await act(async () => {
      allowed = await hook.current.ensureFreshQuoteForConfirmation();
    });
    expect(allowed).toBe(false);
    expect(hook.current.quote?.price).toBe(12000);
    await act(async () => {
      allowed = await hook.current.ensureFreshQuoteForConfirmation();
    });
    expect(allowed).toBe(true);
  });

  it('invalidates the old quote as soon as an address field changes', async () => {
    api.getQuote.mockResolvedValue({
      ...result,
      availableBalance: 11000,
      shortfall: 0,
      canBook: true,
    });
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => hook.current.updateAddressField('city', 'Lekki'));
    expect(hook.current.quote).toBeNull();
    expect(hook.current.wallet).toBeNull();
  });

  it('clears a prior bookable quote when the server reports missing fields', async () => {
    api.getQuote
      .mockResolvedValueOnce({
        ...result,
        availableBalance: 11000,
        shortfall: 0,
        canBook: true,
      })
      .mockRejectedValueOnce({
        code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
        missing: ['city'],
        message: 'Incomplete',
      });
    const { result: hook } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    await act(() => hook.current.requestQuote());
    expect(hook.current.quote).toBeNull();
    expect(hook.current.wallet).toBeNull();
    expect(hook.current.missingFields).toEqual(['city']);
  });
});
