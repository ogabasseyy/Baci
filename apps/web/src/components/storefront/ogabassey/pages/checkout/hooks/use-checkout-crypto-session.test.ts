import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutCryptoSession } from './use-checkout-crypto-session';

const mocks = vi.hoisted(() => ({
  cancelCryptoInitialization: vi.fn(),
  routerPush: vi.fn(),
  juicywayOptions: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('./use-juicyway-payment', () => ({
  useJuicywayPayment: (options: unknown) => {
    mocks.juicywayOptions = options;
    return {
      cryptoPaymentData: null,
      setCryptoPaymentData: vi.fn(),
      isVerifyingCrypto: false,
      cryptoVerificationStatus: 'idle',
      isInitializingCrypto: false,
      initializeCryptoPayment: vi.fn(),
      verifyCryptoPayment: vi.fn(),
      dismissCryptoModal: vi.fn(),
      cancelCryptoInitialization: mocks.cancelCryptoInitialization,
    };
  },
}));

describe('useCheckoutCryptoSession', () => {
  const options = () => ({
    merchantId: 'merchant-1',
    clearCheckoutSession: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    clearCart: vi.fn(),
    getHref: (path: string) => `/shop${path}`,
    isOrderInFlightRef: { current: true },
  });

  beforeEach(() => {
    mocks.cancelCryptoInitialization.mockReset();
    mocks.routerPush.mockReset();
    mocks.juicywayOptions = undefined;
  });

  it('cancels initialization and selects a compatible chain when currency changes', () => {
    const { result } = renderHook(() => useCheckoutCryptoSession(options()));

    expect(result.current.selectedCryptoChain).toBe('TRX');
    expect(result.current.supportedChains).toEqual(['TRX', 'ETH']);

    act(() => result.current.changeCurrency('USDC'));

    expect(mocks.cancelCryptoInitialization).toHaveBeenCalledOnce();
    expect(result.current.selectedCryptoCurrency).toBe('USDC');
    expect(result.current.selectedCryptoChain).toBe('ETH');
    expect(result.current.supportedChains).toEqual(['ETH', 'MATIC', 'AVAXC']);
  });

  it('preserves a chain supported by the newly selected currency', () => {
    const { result } = renderHook(() => useCheckoutCryptoSession(options()));

    act(() => result.current.changeChain('ETH'));
    act(() => result.current.changeCurrency('USDC'));

    expect(result.current.selectedCryptoChain).toBe('ETH');
    expect(mocks.cancelCryptoInitialization).toHaveBeenCalledTimes(2);
  });

  it('routes Juicyway success navigation through the storefront route helper', () => {
    renderHook(() => useCheckoutCryptoSession(options()));

    const juicywayOptions = mocks.juicywayOptions as {
      routerPush: (url: string) => void;
    };
    act(() => juicywayOptions.routerPush('/shop/order-success'));

    expect(mocks.routerPush).toHaveBeenCalledWith('/shop/order-success');
  });

  it('cancels initialization and clears selector attempt state on close', () => {
    const config = options();
    const { result } = renderHook(() => useCheckoutCryptoSession(config));

    act(() => {
      result.current.setPendingCryptoOrder({
        orderId: 'order-1',
        amount: 5000,
        total: 5000,
        orderCurrency: 'NGN',
        customerEmail: 'buyer@example.test',
        customerName: 'Buyer',
        customerPhone: '+2348012345678',
        billingAddress: {
          line1: '1 Main St',
          city: 'Lagos',
          state: 'Lagos',
          country: 'NG',
          zip_code: '100001',
        },
        items: [],
      });
      result.current.setShowCryptoSelector(true);
    });

    act(() => result.current.closeSelector());

    expect(mocks.cancelCryptoInitialization).toHaveBeenCalledOnce();
    expect(result.current.showCryptoSelector).toBe(false);
    expect(result.current.pendingCryptoOrder).toBeNull();
    expect(config.isOrderInFlightRef.current).toBe(false);
  });
});
