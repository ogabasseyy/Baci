// Register the shared mocks before importing the mocked modules below.
import '@/test-support/wallet-checkout-fixture';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  WalletTopUpStillProcessingError,
  waitForWalletTopUpConfirmation,
} from '@/lib/wallet-top-up';
import {
  renderWalletCheckoutScreen,
  setWalletSearchParams,
} from '@/test-support/wallet-checkout-fixture';

describe('Paystack wallet funding checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers safe recovery for a stalled Paystack wallet checkout instead of claiming payment failed', () => {
    jest.useFakeTimers();
    setWalletSearchParams({
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });

    renderWalletCheckoutScreen();
    fireEvent.press(screen.getByLabelText('mock-checkout-load-start'));
    act(() => jest.advanceTimersByTime(45_000));

    expect(screen.queryByText('Payment Failed')).toBeNull();
    expect(screen.getByText('Wallet funding needs attention')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Check funding status' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open Paystack in browser' })
    ).toBeTruthy();
  });

  it('opens the same Paystack session and verifies the same wallet reference after a stalled checkout', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    setWalletSearchParams({
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
      returnTo: '/utilities/airtime?amount=1000',
    });
    jest
      .mocked(WebBrowser.openBrowserAsync)
      .mockResolvedValueOnce({ type: WebBrowser.WebBrowserResultType.DISMISS });
    jest.mocked(waitForWalletTopUpConfirmation).mockResolvedValueOnce({
      reference: 'WAL-123',
      status: 'successful',
      success: true,
      wallet: { balance: 1000 },
    });

    renderWalletCheckoutScreen();
    fireEvent.press(screen.getByLabelText('mock-checkout-load-start'));
    act(() => jest.advanceTimersByTime(45_000));
    fireEvent.press(
      screen.getByRole('button', { name: 'Open Paystack in browser' })
    );
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://checkout.paystack.com/test'
      )
    );
    expect(waitForWalletTopUpConfirmation).not.toHaveBeenCalled();

    fireEvent.press(
      screen.getByRole('button', { name: 'Check funding status' })
    );
    await waitFor(() =>
      expect(waitForWalletTopUpConfirmation).toHaveBeenCalledWith({
        gateway: 'paystack',
        merchantId: 'merchant-1',
        merchantSlug: undefined,
        reference: 'WAL-123',
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Payment Successful!')).toBeTruthy()
    );
    act(() => jest.advanceTimersByTime(1500));
    expect(router.replace).toHaveBeenCalledWith(
      '/utilities/airtime?amount=1000'
    );
  });

  it('keeps an interactive wallet checkout visible and offers recovery if loading never finishes', async () => {
    jest.useFakeTimers();
    setWalletSearchParams({
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });
    renderWalletCheckoutScreen();
    fireEvent.press(screen.getByLabelText('mock-checkout-load-start'));
    expect(screen.getByText('Loading Paystack...')).toBeTruthy();
    expect(screen.getByText('webview-start-loading:false')).toBeTruthy();
    await act(async () =>
      fireEvent.press(screen.getByLabelText('mock-checkout-interactive'))
    );
    expect(screen.queryByText('Loading Paystack...')).toBeNull();
    act(() => jest.advanceTimersByTime(45_000));
    expect(
      screen.getByText('webview:https://checkout.paystack.com/test')
    ).toBeTruthy();
    expect(waitForWalletTopUpConfirmation).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Recover wallet funding checkout' })
    );
    expect(screen.getByText('Wallet funding needs attention')).toBeTruthy();
  });

  it('does not claim success or reopen checkout when the funding is still processing', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    setWalletSearchParams({
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });
    jest
      .mocked(waitForWalletTopUpConfirmation)
      .mockRejectedValueOnce(
        new WalletTopUpStillProcessingError(
          'Wallet top-up is still processing. Check your wallet shortly.'
        )
      );
    renderWalletCheckoutScreen();
    fireEvent.press(screen.getByLabelText('mock-checkout-load-start'));
    act(() => jest.advanceTimersByTime(45_000));
    fireEvent.press(
      screen.getByRole('button', { name: 'Check funding status' })
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          'Wallet top-up is still processing. Check your wallet shortly.'
        )
      ).toBeTruthy()
    );
    expect(screen.queryByText('Payment Successful!')).toBeNull();
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
