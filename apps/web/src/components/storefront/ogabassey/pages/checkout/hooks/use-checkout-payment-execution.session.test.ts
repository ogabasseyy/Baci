import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPaymentExecutionOptions } from './use-checkout-payment-execution';
import {
  createOptions,
  crypto,
  dva,
  handlePlaceOrder,
  waitForResolvedCustomerAuth,
  walletTransfer,
} from './use-checkout-payment-execution.test-support';

const mocks = vi.hoisted(() => ({
  clearIdempotencyKey: vi.fn(),
  captureCompleted: vi.fn(),
  push: vi.fn(),
  useCrypto: vi.fn(),
  useCustomer: vi.fn(),
  useDva: vi.fn(),
  useSubmission: vi.fn(),
  useTransfer: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: mocks.captureCompleted,
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: mocks.clearIdempotencyKey,
}));
vi.mock('./use-checkout-crypto-session', () => ({
  useCheckoutCryptoSession: mocks.useCrypto,
}));
vi.mock('./use-checkout-dva-session', () => ({
  useCheckoutDvaSession: mocks.useDva,
}));
vi.mock('./use-checkout-order-submission', () => ({
  useCheckoutOrderSubmission: mocks.useSubmission,
}));
vi.mock('./use-storefront-customer-session', () => ({
  useStorefrontCustomerSession: mocks.useCustomer,
}));
vi.mock('./use-wallet-funded-bank-transfer', () => ({
  useWalletFundedBankTransfer: mocks.useTransfer,
}));

import { useCheckoutOrderSubmission } from './use-checkout-order-submission';
import { useCheckoutPaymentExecution } from './use-checkout-payment-execution';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDva.mockReturnValue(dva);
  mocks.useCrypto.mockReturnValue(crypto);
  mocks.useCustomer.mockReturnValue({
    waitForResolvedAuthenticated: waitForResolvedCustomerAuth,
  });
  mocks.useTransfer.mockReturnValue(walletTransfer);
  mocks.useSubmission.mockReturnValue({ handlePlaceOrder });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCheckoutPaymentExecution session mapping', () => {
  it('maps latest persisted form values and attempt callbacks into submission', () => {
    const initial = createOptions();
    const { rerender } = renderHook(
      ({ options }: { options: CheckoutPaymentExecutionOptions }) =>
        useCheckoutPaymentExecution(options),
      { initialProps: { options: initial } }
    );
    const latestPaymentSession = {
      method: 'paystack',
      total: 9600,
      wallet: { remainingAmount: 8200 },
    };
    const latestTryBeginSubmission = vi.fn(() => false);
    const next = {
      ...initial,
      form: {
        ...initial.form,
        session: {
          ...initial.form.session,
          values: {
            ...initial.form.session.values,
            customerEmail: 'new@example.test',
            customerPhone: '+2348000000000',
            firstName: 'New',
            lastName: 'Customer',
            newsletterOptIn: true,
            deliveryMethod: 'airport',
            airportType: 'pickup',
            airportRequiresQuote: true,
            newAddressStreet: '2 Main St',
            newAddressCity: 'Abuja',
            newAddressState: 'FCT',
          },
        },
      },
      payment: {
        ...initial.payment,
        session:
          latestPaymentSession as unknown as CheckoutPaymentExecutionOptions['payment']['session'],
      },
      attempt: {
        ...initial.attempt,
        tryBeginSubmission: latestTryBeginSubmission,
      },
    } as unknown as CheckoutPaymentExecutionOptions;

    rerender({ options: next });

    const submission = vi
      .mocked(useCheckoutOrderSubmission)
      .mock.calls.at(-1)?.[0];
    expect(submission?.contact).toEqual({
      customerEmail: 'new@example.test',
      customerPhone: '+2348000000000',
      firstName: 'New',
      lastName: 'Customer',
      newsletterOptIn: true,
    });
    expect(submission?.delivery).toEqual(
      expect.objectContaining({
        method: 'airport',
        airportType: 'pickup',
        airportRequiresQuote: true,
        newAddressStreet: '2 Main St',
        newAddressCity: 'Abuja',
        newAddressState: 'FCT',
      })
    );
    expect(submission?.payment.session).toBe(latestPaymentSession);
    expect(submission?.payment.session.total).toBe(9600);
    expect(submission?.payment.session.wallet.remainingAmount).toBe(8200);
    expect(submission?.account.createAccount).toBe(
      next.form.account.createAccount
    );
    expect(submission?.navigation.setCurrentStep).toBe(
      next.navigation.flow.setCurrentStep
    );
    expect(submission?.order.pending).toBe(next.attempt.pendingCheckoutOrder);
    expect(submission?.order.clearPending).toBe(
      next.attempt.clearPendingCheckoutOrder
    );
    expect(submission?.order.clearCheckoutSession).toBe(
      next.form.session.clear
    );
    expect(submission?.processing.tryBeginSubmission).toBe(
      latestTryBeginSubmission
    );
  });
});
