import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import {
  type CryptoPaymentState,
  useCheckoutCryptoPayment,
} from './use-checkout-crypto-payment';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentStarted: jest.fn(async () => undefined),
}));

const mockTrackCheckoutPaymentStarted = jest.mocked(
  trackCheckoutPaymentStarted
);

function mockInitOnce(init: Record<string, unknown>) {
  global.fetch = jest.fn(
    async () => new Response(JSON.stringify(init), { status: 200 })
  ) as unknown as typeof fetch;
}

function pendingCryptoOrder() {
  return {
    order: { id: 'order-1', order_number: 'ORD-1' },
    orderResponse: { amountDueToGateway: 5000 },
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    customerPhone: '08010000000',
    trackingToken: 'track-1',
  } as never;
}

function juicywayInit(reference: string, paymentId: string) {
  return {
    success: true,
    reference,
    crypto_payment: {
      address: '0xabc',
      chain: 'tron',
      currency: 'USDT',
      amount: 5000,
      crypto_amount: '3.1',
      confirmation_time: '5 min',
      payment_id: paymentId,
    },
  };
}

function renderCryptoHook() {
  return renderHook(() =>
    useCheckoutCryptoPayment({
      isOrderInFlight: { current: false },
      setIsProcessing: () => undefined,
      total: 5000,
    })
  );
}

describe('useCheckoutCryptoPayment juicyway start reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stamps the start with the initialized reference', async () => {
    mockInitOnce(juicywayInit('juicy-ref-1', 'pay-1'));
    const { result } = renderCryptoHook();

    await act(async () => {
      result.current.setPendingOrder(pendingCryptoOrder());
    });
    await act(async () => {
      await result.current.handleCryptoConfirm('tron', 'USDT');
    });

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'juicyway',
        reference: 'juicy-ref-1',
      })
    );
    const state: CryptoPaymentState | null = result.current.cryptoPayment;
    expect(state?.reference).toBe('juicy-ref-1');
  });

  it('keeps two attempts distinguishable when a retry reinitializes', async () => {
    let initCalls = 0;
    global.fetch = jest.fn(async () => {
      initCalls += 1;
      return new Response(
        JSON.stringify(
          initCalls === 1
            ? juicywayInit('juicy-ref-1', 'pay-1')
            : juicywayInit('juicy-ref-2', 'pay-2')
        ),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const { result } = renderCryptoHook();

    // First attempt on one network, then a retry on another coin: each
    // initialization returns its own provider reference.
    await act(async () => {
      result.current.setPendingOrder(pendingCryptoOrder());
    });
    await act(async () => {
      await result.current.handleCryptoConfirm('tron', 'USDT');
    });
    await act(async () => {
      result.current.setPendingOrder(pendingCryptoOrder());
    });
    await act(async () => {
      await result.current.handleCryptoConfirm('ethereum', 'USDC');
    });

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reference: 'juicy-ref-1' })
    );
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reference: 'juicy-ref-2' })
    );
  });

  it('falls back to the payment id when no reference is returned', async () => {
    mockInitOnce(juicywayInit('', 'pay-9'));
    const { result } = renderCryptoHook();

    await act(async () => {
      result.current.setPendingOrder(pendingCryptoOrder());
    });
    await act(async () => {
      await result.current.handleCryptoConfirm('tron', 'USDT');
    });

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'pay-9' })
    );
    // The canonical fallback lives in state too: the completion handoff
    // forwards `reference`, so without this the settlement poller could
    // emit the completion but never reconcile it to its start.
    const state: CryptoPaymentState | null = result.current.cryptoPayment;
    expect(state?.reference).toBe('pay-9');
    expect(state?.paymentId).toBe('pay-9');
  });
});
