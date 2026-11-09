import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { createAgenticCheckoutPaymentAccount } from '@/lib/agentic/checkout-payment-account';
import {
  buildCheckoutPaymentClaimReference,
  claimCheckoutPaymentSetup,
  markCheckoutPaymentAccountReady,
  releaseCheckoutPaymentClaim,
} from '@/lib/agentic/checkout-payment-claim';
import { prepareAgenticCheckoutPayment } from '@/lib/agentic/checkout-payment-setup';

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/checkout-payment-account', () => ({
  createAgenticCheckoutPaymentAccount: vi.fn(),
}));
vi.mock('@/lib/agentic/checkout-payment-claim', () => ({
  buildCheckoutPaymentClaimReference: vi.fn(),
  claimCheckoutPaymentSetup: vi.fn(),
  markCheckoutPaymentAccountReady: vi.fn(),
  releaseCheckoutPaymentClaim: vi.fn(),
}));

import {
  buyer,
  dvaAccount,
  paymentInput,
  session,
  sessionCalc,
} from './checkout-payment-setup.test-support';

describe('prepareAgenticCheckoutPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildCheckoutPaymentClaimReference).mockReturnValue(
      'agentic_claim_1'
    );
    vi.mocked(releaseCheckoutPaymentClaim).mockResolvedValue({
      error: null,
      released: true,
    });
  });

  it('resumes a stored payment account without creating duplicate side effects', async () => {
    const result = await prepareAgenticCheckoutPayment(
      paymentInput({
        canResumePaymentAccount: true,
        storedDvaAccount: dvaAccount,
      })
    );

    expect(result).toMatchObject({
      ok: true,
      payment: {
        dvaAccount,
        session,
        sessionCalc,
      },
    });
    expect(claimCheckoutPaymentSetup).not.toHaveBeenCalled();
  });

  it('claims the session and stores the generated account before order creation', async () => {
    vi.mocked(claimCheckoutPaymentSetup).mockResolvedValue({
      claimed: true,
      error: null,
      session,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue(sessionCalc);
    vi.mocked(createAgenticCheckoutPaymentAccount).mockResolvedValue({
      account: {
        ...dvaAccount,
        assigned: true,
        currency: 'NGN',
      },
      ok: true,
    });
    vi.mocked(markCheckoutPaymentAccountReady).mockResolvedValue({
      error: null,
      stored: true,
    });

    const result = await prepareAgenticCheckoutPayment(paymentInput());

    expect(result).toMatchObject({
      ok: true,
      payment: {
        dvaAccount,
        session,
        sessionCalc,
      },
    });
    expect(claimCheckoutPaymentSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        claimReference: 'agentic_claim_1',
        sessionId: 'agentic_session_1',
      })
    );
    expect(markCheckoutPaymentAccountReady).toHaveBeenCalledWith(
      expect.objectContaining({
        claimReference: 'agentic_claim_1',
        dvaAccount: expect.objectContaining(dvaAccount),
        merchantId: 'merchant-1',
      })
    );
    expect(createAgenticCheckoutPaymentAccount).toHaveBeenCalledWith({
      buyer,
      paystackSubaccountCode: 'ACCT_TESTMOCK1234567',
    });
  });

  it('returns a database error when the payment setup claim write fails', async () => {
    vi.mocked(claimCheckoutPaymentSetup).mockResolvedValue({
      claimed: false,
      error: {
        code: 'PGRST000',
        details: '',
        hint: '',
        message: 'claim write failed',
        name: 'PostgrestError',
        toJSON() {
          return this;
        },
      },
      session: null,
    });

    const result = await prepareAgenticCheckoutPayment(paymentInput());

    expect(result).toEqual({
      body: { error: 'Database error' },
      ok: false,
      status: 500,
    });
    expect(createAgenticCheckoutPaymentAccount).not.toHaveBeenCalled();
    expect(releaseCheckoutPaymentClaim).not.toHaveBeenCalled();
  });

  it('retains the claim when payment account creation is uncertain', async () => {
    vi.mocked(claimCheckoutPaymentSetup).mockResolvedValue({
      claimed: true,
      error: null,
      session,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue(sessionCalc);
    vi.mocked(createAgenticCheckoutPaymentAccount).mockResolvedValue({
      error: new Error('paystack down'),
      errorMessage: 'paystack down',
      ok: false,
    });

    const result = await prepareAgenticCheckoutPayment(paymentInput());

    expect(result).toEqual({
      body: {
        details: 'Payment provider error',
        error: 'Failed to generate payment account',
      },
      ok: false,
      status: 502,
    });
    expect(releaseCheckoutPaymentClaim).not.toHaveBeenCalled();
  });

  it('does not release the claim after a provider failure', async () => {
    vi.mocked(claimCheckoutPaymentSetup).mockResolvedValue({
      claimed: true,
      error: null,
      session,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue(sessionCalc);
    vi.mocked(createAgenticCheckoutPaymentAccount).mockResolvedValue({
      error: new Error('paystack down'),
      errorMessage: 'paystack down',
      ok: false,
    });
    vi.mocked(releaseCheckoutPaymentClaim).mockRejectedValue(
      new Error('release failed')
    );

    const result = await prepareAgenticCheckoutPayment(paymentInput());

    expect(result).toEqual({
      body: {
        details: 'Payment provider error',
        error: 'Failed to generate payment account',
      },
      ok: false,
      status: 502,
    });
  });

  it('does not persist a raw payment account number when marking ready fails', async () => {
    vi.mocked(claimCheckoutPaymentSetup).mockResolvedValue({
      claimed: true,
      error: null,
      session,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue(sessionCalc);
    vi.mocked(createAgenticCheckoutPaymentAccount).mockResolvedValue({
      account: {
        ...dvaAccount,
        assigned: true,
        currency: 'NGN',
      },
      ok: true,
    });
    vi.mocked(markCheckoutPaymentAccountReady).mockResolvedValue({
      error: {
        code: 'PGRST000',
        details: '',
        hint: '',
        message: 'database leaked 1234567890',
        name: 'PostgrestError',
        toJSON() {
          return this;
        },
      },
      stored: false,
    });

    const result = await prepareAgenticCheckoutPayment(paymentInput());

    expect(result).toEqual({
      body: { error: 'Database error' },
      ok: false,
      status: 500,
    });
    expect(releaseCheckoutPaymentClaim).not.toHaveBeenCalled();
  });
});
