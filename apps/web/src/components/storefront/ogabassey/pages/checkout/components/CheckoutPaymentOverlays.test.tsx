import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CheckoutPaymentOverlays } from './CheckoutPaymentOverlays';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('routes selector close to the owner callback', async () => {
  const onClose = vi.fn();
  render(
    <CheckoutPaymentOverlays
      cryptoSelector={{
        selectedCryptoCurrency: 'USDT',
        selectedCryptoChain: 'TRX',
        supportedChains: ['TRX'],
        isInitializingCrypto: false,
        onCurrencyChange: vi.fn(),
        onChainChange: vi.fn(),
        onInitialize: vi.fn(),
        onClose,
      }}
      walletTransfer={{}}
    />
  );

  fireEvent.click(
    await screen.findByRole('button', { name: 'Close crypto selector' })
  );

  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps consent actions attached to the wallet funding request', async () => {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  render(
    <CheckoutPaymentOverlays
      walletTransfer={{
        consent: { merchantName: 'Ogabassey', onAccept, onDecline },
      }}
    />
  );

  expect(
    await screen.findByText(/Ogabassey will create a permanent bank account/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
  fireEvent.click(screen.getByRole('button', { name: /Not now/ }));

  expect(onAccept).toHaveBeenCalledOnce();
  expect(onDecline).toHaveBeenCalledOnce();
});

it('keeps wallet funded account copy, check, and close actions wired', async () => {
  const onCheckNow = vi.fn();
  const onClose = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(
    <CheckoutPaymentOverlays
      walletTransfer={{
        funding: {
          account: {
            accountName: 'Ada Buyer',
            accountNumber: '0123456789',
            bankName: 'Paystack Bank',
            provider: 'paystack',
          },
          error: null,
          formatCurrency: (amount) => `₦${amount.toLocaleString()}`,
          intent: {
            currency: 'NGN',
            expectedAmount: 5000,
            expiresAt: '2026-09-29T16:00:00+00:00',
            fundedAmount: 0,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'pending',
            targetOrderAmount: 5000,
          },
          isChecking: false,
          onCheckNow,
          onClose,
        },
      }}
    />
  );

  fireEvent.click(
    await screen.findByRole('button', { name: 'Copy account number' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: "I've sent it — check now" })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check later' })
  );

  expect(writeText).toHaveBeenCalledWith('0123456789');
  expect(onCheckNow).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps legacy DVA confirmation and close actions wired', () => {
  const onClose = vi.fn();
  const onConfirmTransfer = vi.fn();
  render(
    <CheckoutPaymentOverlays
      dva={{
        data: {
          account_number: '1234567890',
          account_name: 'Ada Buyer',
          bank_name: 'Test Bank',
          bank_code: '001',
          amount: 5000,
          reference: 'legacy-dva-reference',
        },
        formatCurrency: (amount) => `₦${amount.toLocaleString()}`,
        isVerifying: false,
        onClose,
        onConfirmTransfer,
      }}
      walletTransfer={{}}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm Transfer Sent' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check later' })
  );

  expect(onConfirmTransfer).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('asks before crypto order-status dismissal and dismisses only after confirmation', () => {
  const onClose = vi.fn();
  const confirmMock = vi.fn().mockReturnValue(false);
  vi.stubGlobal('confirm', confirmMock);
  render(
    <CheckoutPaymentOverlays
      cryptoPayment={{
        data: {
          address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
          chain: 'TRX',
          currency: 'USDT',
          amount: 1250,
          confirmation_time: '10 minutes',
          orderId: 'test-order',
          reference: 'test-reference',
          sessionId: 'test-session',
          paymentId: 'test-payment',
        },
        verificationStatus: 'idle',
        isVerifying: false,
        onVerify: vi.fn(),
        onClose,
      }}
      walletTransfer={{}}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check order status later' })
  );
  expect(confirmMock).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();

  confirmMock.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check order status later' })
  );
  expect(onClose).toHaveBeenCalledOnce();
});
