import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { WebViewNavigation } from 'react-native-webview';
import {
  SavingsAuthorizationStillProcessingError,
  waitForSavingsAuthorizationConfirmation,
} from '@/lib/customer-savings';
import {
  VtuPaymentStillProcessingError,
  waitForVtuConfirmation,
} from '@/lib/vtu-checkout';
import {
  clearWalletFundingIntentIfUnchanged,
  readWalletFundingIntentSnapshot,
} from '@/lib/wallet-funding-intent';
import {
  WalletTopUpStillProcessingError,
  waitForWalletTopUpConfirmation,
} from '@/lib/wallet-top-up';
import { usePaymentGatewayController } from './use-payment-gateway-controller';

const mockClearCart = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastComponent = jest.fn(() => null);
const mockInvalidateQueries = jest.fn<(options: unknown) => Promise<void>>(() =>
  Promise.resolve()
);

let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    error: mockToastError,
    success: mockToastSuccess,
    Toast: mockToastComponent,
  }),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/lib/wallet-funding-intent', () => ({
  clearWalletFundingIntentIfUnchanged: jest.fn(),
  readWalletFundingIntentSnapshot: jest.fn(),
}));

jest.mock('@/lib/customer-savings', () => ({
  SavingsAuthorizationStillProcessingError: class SavingsAuthorizationStillProcessingError extends Error {
    constructor() {
      super(
        'Savings card authorization is still processing. Check again shortly.'
      );
      this.name = 'SavingsAuthorizationStillProcessingError';
    }
  },
  waitForSavingsAuthorizationConfirmation: jest.fn(),
}));

jest.mock('@/lib/vtu-checkout', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/vtu-checkout')>(
      '@/lib/vtu-checkout'
    );

  return {
    ...actual,
    waitForVtuConfirmation: jest.fn(),
  };
});

jest.mock('@/lib/wallet-top-up', () => ({
  waitForWalletTopUpConfirmation: jest.fn(),
  WalletTopUpStillProcessingError: class WalletTopUpStillProcessingError extends Error {
    reference: string;

    constructor(reference: string) {
      super('Wallet top-up is still processing. Check your wallet shortly.');
      this.name = 'WalletTopUpStillProcessingError';
      this.reference = reference;
    }
  },
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: mockClearCart }),
}));

const mockWaitForVtuConfirmation = jest.mocked(waitForVtuConfirmation);
const mockWaitForWalletTopUpConfirmation = jest.mocked(
  waitForWalletTopUpConfirmation
);
const mockWaitForSavingsAuthorizationConfirmation = jest.mocked(
  waitForSavingsAuthorizationConfirmation
);
const mockClearWalletFundingIntent = jest.mocked(
  clearWalletFundingIntentIfUnchanged
);
const mockReadWalletFundingIntentSnapshot = jest.mocked(
  readWalletFundingIntentSnapshot
);

const orderParams = {
  amount: '1000',
  authorizationUrl: 'https://checkout.paystack.com/test',
  gateway: 'paystack',
  orderId: 'order-123',
  orderNumber: 'ORD-123',
  paymentKind: 'order',
  reference: 'ref-123',
};

const vtuParams = {
  amount: '2500',
  authorizationUrl: 'https://checkout.paystack.com/test',
  customerIdentifier: '43901766923',
  gateway: 'paystack',
  paymentKind: 'vtu',
  reference: 'VTU-123',
  utilityType: 'power',
};

const walletParams = {
  amount: '2500',
  authorizationUrl: 'https://checkout.paystack.com/test',
  gateway: 'paystack',
  merchantId: 'merchant-1',
  paymentKind: 'wallet',
  reference: 'WAL-123',
};

const savingsAuthorizationParams = {
  authorizationUrl: 'https://checkout.paystack.com/savings-auth',
  gateway: 'paystack',
  paymentKind: 'savings_auth',
  reference: 'SAV-AUTH-123',
  returnTo: '/wallet/savings/start',
};

function navigation(url: string) {
  return { url } as WebViewNavigation;
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe('usePaymentGatewayController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockSearchParams = { ...orderParams };
    mockWaitForVtuConfirmation.mockResolvedValue({
      amount: 2500,
      reference: 'VTU-123',
      status: 'successful',
    });
    mockWaitForWalletTopUpConfirmation.mockResolvedValue({
      amount: 2500,
      reference: 'WAL-123',
      status: 'successful',
      success: true,
      wallet: {
        balance: 7500,
      },
    });
    mockClearWalletFundingIntent.mockResolvedValue(true);
    mockReadWalletFundingIntentSnapshot.mockResolvedValue('intent-snapshot-1');
    mockWaitForSavingsAuthorizationConfirmation.mockResolvedValue({
      reference: 'SAV-AUTH-123',
      savedPaymentMethodId: 'card-1',
      status: 'successful',
      success: true,
    });
  });

  it('reports invalid route params without exposing checkout state as valid', () => {
    mockSearchParams = {
      gateway: 'paystack',
      paymentKind: 'order',
      reference: 'ref-123',
    };

    const { result } = renderHook(() => usePaymentGatewayController());

    expect(result.current.validatedParams).toMatchObject({
      data: null,
      isValid: false,
    });
    expect(result.current.validatedParams.error).toBeTruthy();
  });

  it('preserves cancellation errors through later WebView load events', () => {
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://checkout.example.com/pay?cancelled=true')
      );
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('Payment was cancelled.');

    act(() => {
      result.current.handleLoadStart();
      result.current.handleLoadEnd();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('Payment was cancelled.');
  });

  it('preserves WebView errors through immediate follow-up load events', () => {
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleWebViewError({
        nativeEvent: {
          description: 'Provider connection failed',
          url: 'https://checkout.paystack.com/test',
        },
      } as Parameters<typeof result.current.handleWebViewError>[0]);
      result.current.handleLoadStart();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('Provider connection failed');
  });

  it('resets retry state and reloads the checkout WebView', () => {
    const reload = jest.fn();
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://checkout.example.com/cancel')
      );
    });

    result.current.webViewRef.current = {
      reload,
    } as unknown as typeof result.current.webViewRef.current;

    act(() => {
      result.current.handleRetry();
    });

    expect(result.current.status).toBe('loading');
    expect(result.current.errorMessage).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error when the provider checkout page stalls while loading', () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleLoadStart();
    });

    expect(result.current.status).toBe('loading');

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(
      'Payment page is taking longer than expected. Check your connection and try again.'
    );
  });

  it('keeps stalled VTU checkout loading retryable instead of confirming unpaid transactions', () => {
    jest.useFakeTimers();
    mockSearchParams = { ...vtuParams };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleLoadStart();
    });

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(
      'Payment page is taking longer than expected. Check your connection and try again.'
    );
    expect(mockWaitForVtuConfirmation).not.toHaveBeenCalled();
  });

  it('clears the cart and navigates after order payment completion', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => usePaymentGatewayController());

    await act(async () => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?trxref=ref-123')
      );
    });

    expect(result.current.status).toBe('success');
    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'paystack',
        reference: 'ref-123',
      },
    });
  });

  it('preserves tracking token when routing completed order payments', async () => {
    jest.useFakeTimers();
    mockSearchParams = {
      ...orderParams,
      trackingToken: 'track-token-123',
    };
    const { result } = renderHook(() => usePaymentGatewayController());

    await act(async () => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?trxref=ref-123')
      );
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-123',
        trackingToken: 'track-token-123',
      }),
    });
  });

  it('uses the close confirmation flow for back actions', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleBack();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel Payment?',
      'Your order has been created. If you leave, you can complete payment later from your orders page.',
      expect.any(Array)
    );
    expect(router.back).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('uses an empty order id when delayed order navigation has no orderId', async () => {
    jest.useFakeTimers();
    mockSearchParams = {
      ...orderParams,
      orderId: undefined as unknown as string,
      orderNumber: 'ORD-123',
    };
    const { result } = renderHook(() => usePaymentGatewayController());

    await act(async () => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?trxref=ref-123')
      );
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({ orderId: '' }),
    });
  });

  it('polls VTU confirmations and routes successful utility payments', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...vtuParams };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=VTU-123')
      );
    });

    expect(result.current.status).toBe('processing');
    await waitFor(() =>
      expect(mockWaitForVtuConfirmation).toHaveBeenCalledWith({
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/utilities/[type]',
      params: {
        amount: '2500',
        customerIdentifier: '43901766923',
        paymentStatus: 'successful',
        reference: 'VTU-123',
        type: 'power',
      },
    });
  });

  it('confirms wallet top-ups, refreshes wallet data, and returns to wallet', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...walletParams };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=WAL-123')
      );
    });

    expect(result.current.status).toBe('processing');
    await waitFor(() =>
      expect(mockWaitForWalletTopUpConfirmation).toHaveBeenCalledWith({
        gateway: 'paystack',
        merchantId: 'merchant-1',
        merchantSlug: undefined,
        reference: 'WAL-123',
      })
    );
    await waitFor(() =>
      expect(mockClearWalletFundingIntent).toHaveBeenCalledTimes(1)
    );
    expect(mockClearWalletFundingIntent).toHaveBeenCalledWith(
      'intent-snapshot-1'
    );
    expect(result.current.errorMessage).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['wallet'],
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith('/wallet');
    expect(mockClearCart).not.toHaveBeenCalled();
  });

  it('returns to a validated returnTo path after wallet top-up success', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...walletParams, returnTo: '/imei-check' };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=WAL-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(mockClearWalletFundingIntent).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith('/imei-check');
  });

  it('keeps a confirmed wallet top-up successful when intent cleanup fails', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...walletParams };
    mockClearWalletFundingIntent.mockResolvedValueOnce(false);
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=WAL-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.errorMessage).toBeNull();
  });

  it('clears the funding intent after confirmation even when the screen unmounts', async () => {
    mockSearchParams = { ...walletParams };
    const confirmation =
      deferred<Awaited<ReturnType<typeof waitForWalletTopUpConfirmation>>>();
    mockWaitForWalletTopUpConfirmation.mockImplementationOnce(
      () => confirmation.promise
    );
    const { result, unmount } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=WAL-123')
      );
    });
    await waitFor(() =>
      expect(mockWaitForWalletTopUpConfirmation).toHaveBeenCalledTimes(1)
    );
    unmount();

    await act(async () => {
      confirmation.resolve({
        amount: 2500,
        reference: 'WAL-123',
        status: 'successful',
        success: true,
        wallet: { balance: 7500 },
      });
      await confirmation.promise;
    });

    expect(mockClearWalletFundingIntent).toHaveBeenCalledTimes(1);
  });

  it('confirms savings card authorization before returning to Start Savings', async () => {
    jest.useFakeTimers();
    mockSearchParams = { ...savingsAuthorizationParams };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation(
          'https://usebaci.com/checkout/success?reference=SAV-AUTH-123'
        )
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockWaitForWalletTopUpConfirmation).not.toHaveBeenCalled();
    expect(mockWaitForSavingsAuthorizationConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: undefined,
        merchantSlug: undefined,
        reference: 'SAV-AUTH-123',
        signal: expect.anything(),
      })
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['wallet'],
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith('/wallet/savings/start');
  });

  it('keeps savings card authorization retryable while confirmation is still processing', async () => {
    mockSearchParams = { ...savingsAuthorizationParams };
    mockWaitForSavingsAuthorizationConfirmation.mockRejectedValueOnce(
      new SavingsAuthorizationStillProcessingError()
    );
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation(
          'https://usebaci.com/checkout/success?reference=SAV-AUTH-123'
        )
      );
    });

    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorMessage).toBe(
      'Savings card authorization is still processing. Check again shortly.'
    );
    expect(router.replace).not.toHaveBeenCalledWith('/wallet/savings/start');
  });

  it('cancels pending savings authorization confirmation without surfacing an error on retry', async () => {
    mockSearchParams = { ...savingsAuthorizationParams };
    let confirmationSignal: AbortSignal | undefined;
    mockWaitForSavingsAuthorizationConfirmation.mockImplementationOnce(
      async ({ signal }) =>
        await new Promise<never>((_resolve, reject) => {
          confirmationSignal = signal;
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error(
                'Savings authorization confirmation cancelled.'
              );
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        })
    );
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation(
          'https://usebaci.com/checkout/success?reference=SAV-AUTH-123'
        )
      );
    });
    await waitFor(() => expect(confirmationSignal).toBeDefined());

    act(() => {
      result.current.handleRetry();
    });

    await waitFor(() => expect(confirmationSignal?.aborted).toBe(true));
    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.errorMessage).toBeNull();
  });

  it('returns to Start Savings after savings card authorization is cancelled', () => {
    jest.useFakeTimers();
    mockSearchParams = { ...savingsAuthorizationParams };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/cancel?reason=cancel')
      );
    });

    expect(result.current.status).toBe('error');
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockWaitForWalletTopUpConfirmation).not.toHaveBeenCalled();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith('/wallet/savings/start');
  });

  it('keeps wallet top-ups retryable when confirmation is still processing', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...walletParams };
    mockWaitForWalletTopUpConfirmation.mockRejectedValueOnce(
      new WalletTopUpStillProcessingError('WAL-123')
    );
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=WAL-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe(
      'Wallet top-up is still processing. Check your wallet shortly.'
    );
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/wallet');
  });

  it('ignores stale successful VTU confirmations after retry', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...vtuParams };
    const confirmation =
      deferred<Awaited<ReturnType<typeof waitForVtuConfirmation>>>();
    mockWaitForVtuConfirmation.mockImplementationOnce(
      () => confirmation.promise
    );
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=VTU-123')
      );
    });

    await waitFor(() =>
      expect(mockWaitForVtuConfirmation).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleRetry();
    });

    await act(async () => {
      confirmation.resolve({
        amount: 2500,
        reference: 'VTU-123',
        status: 'successful',
      });
      await confirmation.promise;
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.status).toBe('loading');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('ignores stale still-processing VTU confirmations after retry', async () => {
    mockSearchParams = { ...vtuParams };
    const confirmation =
      deferred<Awaited<ReturnType<typeof waitForVtuConfirmation>>>();
    mockWaitForVtuConfirmation.mockImplementationOnce(
      () => confirmation.promise
    );
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=VTU-123')
      );
    });

    await waitFor(() =>
      expect(mockWaitForVtuConfirmation).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleRetry();
    });

    await act(async () => {
      confirmation.reject(
        new VtuPaymentStillProcessingError({
          reference: 'VTU-123',
        })
      );
      await confirmation.promise.catch(() => undefined);
    });

    expect(result.current.status).toBe('loading');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('confirms VTU crypto success messages before routing to success', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...vtuParams };
    mockWaitForVtuConfirmation.mockResolvedValueOnce({
      amount: 2750,
      customerIdentifier: '1234567890',
      reference: 'crypto-ref',
      status: 'successful',
    });
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            amount: '2750',
            customerIdentifier: ' 1234567890 ',
            reference: ' crypto-ref ',
            type: 'crypto_success',
          }),
        },
      });
    });

    await waitFor(() =>
      expect(mockWaitForVtuConfirmation).toHaveBeenCalledWith({
        gateway: 'paystack',
        reference: 'crypto-ref',
      })
    );
    expect(router.replace).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/utilities/[type]',
        params: expect.objectContaining({
          amount: '2750',
          customerIdentifier: '1234567890',
          paymentStatus: 'successful',
          reference: 'crypto-ref',
          type: 'power',
        }),
      })
    );
  });

  it('does not route VTU confirmations after unmount', async () => {
    mockSearchParams = { ...vtuParams };
    const confirmation =
      deferred<Awaited<ReturnType<typeof waitForVtuConfirmation>>>();
    mockWaitForVtuConfirmation.mockImplementationOnce(
      () => confirmation.promise
    );
    const { result, unmount } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=VTU-123')
      );
    });

    await waitFor(() =>
      expect(mockWaitForVtuConfirmation).toHaveBeenCalledTimes(1)
    );

    unmount();

    await act(async () => {
      confirmation.reject(
        new VtuPaymentStillProcessingError({
          reference: 'VTU-123',
        })
      );
      await confirmation.promise.catch(() => undefined);
    });

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('preserves VTU cashback params when routing successful utility payments', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = { ...vtuParams };
    mockWaitForVtuConfirmation.mockResolvedValue({
      amount: 2500,
      cashback: {
        amount: 50,
        credited: true,
        newBalance: 1050,
      },
      reference: 'VTU-123',
      status: 'successful',
    });
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=VTU-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/utilities/[type]',
      params: expect.objectContaining({
        cashbackAmount: '50',
        cashbackNewBalance: '1050',
        paymentStatus: 'successful',
        reference: 'VTU-123',
      }),
    });
  });

  it('routes Juicyway VTU completions without polling confirmation', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = {
      ...vtuParams,
      gateway: 'juicyway',
      reference: 'JW-123',
    };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=JW-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mockWaitForVtuConfirmation).not.toHaveBeenCalled();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/utilities/[type]',
      params: {
        amount: '2500',
        customerIdentifier: '43901766923',
        paymentStatus: 'successful',
        reference: 'JW-123',
        type: 'power',
      },
    });
  });

  it('cancels pending Juicyway VTU navigation when retrying', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchParams = {
      ...vtuParams,
      gateway: 'juicyway',
      reference: 'JW-123',
    };
    const { result } = renderHook(() => usePaymentGatewayController());

    act(() => {
      result.current.handleNavigationChange(
        navigation('https://usebaci.com/checkout/success?reference=JW-123')
      );
    });

    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      result.current.handleRetry();
      jest.runOnlyPendingTimers();
    });

    expect(result.current.status).toBe('loading');
    expect(router.replace).not.toHaveBeenCalled();
  });
});
