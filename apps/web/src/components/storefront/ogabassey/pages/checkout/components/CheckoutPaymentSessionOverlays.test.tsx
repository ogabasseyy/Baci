import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletOrderFundingIntent } from '@/schemas/order-wallet-funding-intent';
import type { WalletFundingAccountResponse } from '@/schemas/wallet-funding-account';
import type { DvaModalData } from '../hooks/use-dva-confirm-transfer';
import type { CryptoPaymentData } from '../types';
import {
  type CheckoutCryptoOverlaySession,
  CheckoutPaymentSessionOverlays,
  type WalletFundedTransferOverlaySession,
} from './CheckoutPaymentSessionOverlays';

function createCryptoSession(
  overrides: Partial<CheckoutCryptoOverlaySession> = {}
): CheckoutCryptoOverlaySession {
  return {
    changeChain: vi.fn(),
    changeCurrency: vi.fn(),
    closeSelector: vi.fn(),
    cryptoPaymentData: null,
    cryptoVerificationStatus: 'idle',
    dismissCryptoModal: vi.fn(),
    initializeCryptoPayment: vi.fn(),
    isInitializingCrypto: false,
    isVerifyingCrypto: false,
    selectedCryptoChain: 'TRX',
    selectedCryptoCurrency: 'USDT',
    showCryptoSelector: false,
    supportedChains: ['TRX'],
    verifyCryptoPayment: vi.fn(),
    ...overrides,
  };
}

function createWalletTransferSession(
  overrides: Partial<WalletFundedTransferOverlaySession> = {}
): WalletFundedTransferOverlaySession {
  return {
    acceptConsent: vi.fn(),
    account: null,
    checkNow: vi.fn(),
    close: vi.fn(),
    consentRequested: false,
    declineConsent: vi.fn(),
    error: null,
    intent: null,
    isChecking: false,
    ...overrides,
  };
}

const dvaData: DvaModalData = {
  account_number: '1234567890',
  account_name: 'Ada Buyer',
  bank_name: 'Test Bank',
  bank_code: '001',
  amount: 5000,
  total: 5000,
  reference: 'legacy-dva-reference',
};

const account: WalletFundingAccountResponse = {
  accountName: 'Ada Buyer',
  accountNumber: '0123456789',
  bankName: 'Paystack Bank',
  provider: 'paystack',
};

const intent: WalletOrderFundingIntent = {
  currency: 'NGN',
  expectedAmount: 5000,
  expiresAt: '2026-09-29T16:00:00+00:00',
  fundedAmount: 0,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  status: 'pending',
  targetOrderAmount: 5000,
};

const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CheckoutPaymentSessionOverlays', () => {
  it('maps crypto selector session state and callbacks to the visible selector', async () => {
    const crypto = createCryptoSession({
      showCryptoSelector: true,
      supportedChains: ['TRX', 'ETH'],
    });

    render(
      <CheckoutPaymentSessionOverlays
        crypto={crypto}
        walletFundedTransfer={createWalletTransferSession()}
        dva={{
          data: null,
          isVerifying: false,
          onClose: vi.fn(),
          onConfirmTransfer: vi.fn(),
        }}
        formatCurrency={formatCurrency}
      />
    );

    expect(
      await screen.findByRole('button', { name: 'Continue with USDT on TRX' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /USDC/ }));
    fireEvent.click(screen.getByRole('button', { name: /ETH/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with USDT on TRX' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close crypto selector' })
    );

    expect(crypto.changeCurrency).toHaveBeenCalledWith('USDC');
    expect(crypto.changeChain).toHaveBeenCalledWith('ETH');
    expect(crypto.initializeCryptoPayment).toHaveBeenCalledOnce();
    expect(crypto.closeSelector).toHaveBeenCalledOnce();
  });

  it('maps crypto verification and close callbacks while confirming dismissal', () => {
    const verifyCryptoPayment = vi.fn();
    const dismissCryptoModal = vi.fn();
    const cryptoPaymentData: CryptoPaymentData = {
      address: '0x1234567890abcdef',
      amount: 12.5,
      chain: 'ETH',
      confirmation_time: '5-30 minutes',
      currency: 'USDC',
      orderId: 'order-1',
      paymentId: 'payment-1',
      reference: 'reference-1',
      sessionId: 'session-1',
    };
    vi.stubGlobal('confirm', () => true);

    render(
      <CheckoutPaymentSessionOverlays
        crypto={createCryptoSession({
          cryptoPaymentData,
          dismissCryptoModal,
          verifyCryptoPayment,
        })}
        walletFundedTransfer={createWalletTransferSession()}
        dva={{
          data: null,
          isVerifying: false,
          onClose: vi.fn(),
          onConfirmTransfer: vi.fn(),
        }}
        formatCurrency={formatCurrency}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: "I've Sent the Payment" })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close and check order status later' })
    );

    expect(verifyCryptoPayment).toHaveBeenCalledOnce();
    expect(dismissCryptoModal).toHaveBeenCalledOnce();
  });

  it('maps wallet consent and funding session actions and status', async () => {
    const acceptConsent = vi.fn();
    const declineConsent = vi.fn();
    const checkNow = vi.fn();
    const close = vi.fn();
    const walletFundedTransfer = createWalletTransferSession({
      acceptConsent,
      account,
      checkNow,
      close,
      consentRequested: true,
      declineConsent,
      error: 'temporary polling error',
      intent,
    });

    render(
      <CheckoutPaymentSessionOverlays
        crypto={createCryptoSession()}
        walletFundedTransfer={walletFundedTransfer}
        dva={{
          data: null,
          isVerifying: false,
          onClose: vi.fn(),
          onConfirmTransfer: vi.fn(),
        }}
        formatCurrency={formatCurrency}
        merchantName="Ogabassey"
      />
    );

    expect(
      await screen.findByText(/Ogabassey will create a permanent bank account/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/could not reach the server to check this transfer/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    fireEvent.click(screen.getByRole('button', { name: /Not now/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /I've sent it — check now/ })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close and check later' })
    );

    expect(acceptConsent).toHaveBeenCalledOnce();
    expect(declineConsent).toHaveBeenCalledOnce();
    expect(checkNow).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('maps DVA data, formatter, and verification callbacks into the bank transfer modal', () => {
    const onClose = vi.fn();
    const onConfirmTransfer = vi.fn();

    render(
      <CheckoutPaymentSessionOverlays
        crypto={createCryptoSession()}
        walletFundedTransfer={createWalletTransferSession()}
        dva={{ data: dvaData, isVerifying: false, onClose, onConfirmTransfer }}
        formatCurrency={formatCurrency}
      />
    );

    expect(screen.getByText('₦5,000')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Transfer Sent' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close and check later' })
    );

    expect(onConfirmTransfer).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
