import { describe, expect, it } from 'vitest';
import {
  isPiggyvestWalletPaid,
  owePiggyvestWalletRefund,
  piggyvestPaymentSourceMetadata,
  piggyvestWalletPaidHold,
} from './vtu-piggyvest-wallet-paid';

describe('isPiggyvestWalletPaid', () => {
  it('is true only for the PiggyVest payment source', () => {
    expect(isPiggyvestWalletPaid({ paymentSource: 'piggyvest_wallet' })).toBe(
      true
    );
    expect(
      isPiggyvestWalletPaid({ paymentSplit: { wallet: 1, card: 0 } })
    ).toBe(false);
    expect(isPiggyvestWalletPaid(null)).toBe(false);
  });
});

describe('owePiggyvestWalletRefund', () => {
  it('records the refund as owed to PiggyVest, once', () => {
    const metadata: Record<string, unknown> = {};
    expect(owePiggyvestWalletRefund(metadata, 500)).toEqual({
      metadataChanged: true,
      refundIssued: true,
      refundedAmount: 500,
    });
    expect(metadata).toMatchObject({
      refundIssued: true,
      refundAmount: 500,
      refundDestination: 'piggyvest_wallet',
    });
    expect(owePiggyvestWalletRefund(metadata, 500).metadataChanged).toBe(false);
  });
});

describe('piggyvestWalletPaidHold', () => {
  it('keeps a failed row failed (never a re-vend)', () => {
    expect(
      piggyvestWalletPaidHold({
        amount: '500',
        request_reference: 'ref',
        status: 'failed',
        error_message: null,
      })
    ).toMatchObject({ status: 'failed', amount: 500 });
  });

  describe('bugfix: a failed row never returns raw provider text', () => {
    const failed = {
      amount: 500,
      request_reference: 'ref',
      status: 'failed',
      error_message: 'Provider 5xx: upstream id 8812 timeout',
    };

    it('returns the fixed customer-safe message for an unflagged stored error', () => {
      const hold = piggyvestWalletPaidHold(failed);
      expect(hold).toMatchObject({ status: 'failed' });
      expect(JSON.stringify(hold)).not.toContain('Provider 5xx');
    });

    it('returns the stored text only when it is flagged first-party', () => {
      expect(
        piggyvestWalletPaidHold({
          ...failed,
          error_message: 'Your purchase could not be completed.',
          metadata: { customerSafeErrorMessage: true },
        })
      ).toMatchObject({ error: 'Your purchase could not be completed.' });
    });
  });

  it('holds a pending row as processing', () => {
    expect(
      piggyvestWalletPaidHold({
        amount: 500,
        request_reference: 'ref',
        status: 'pending',
      })
    ).toEqual({ amount: 500, reference: 'ref', status: 'processing' });
  });
});

describe('piggyvestPaymentSourceMetadata', () => {
  it('marks only a checkout row paid from the PiggyVest wallet', () => {
    expect(
      piggyvestPaymentSourceMetadata('checkout', 'piggyvest_wallet')
    ).toEqual({
      paymentSource: 'piggyvest_wallet',
    });
    expect(piggyvestPaymentSourceMetadata('checkout', 'store_credit')).toEqual(
      {}
    );
    expect(piggyvestPaymentSourceMetadata('checkout', undefined)).toEqual({});
    expect(piggyvestPaymentSourceMetadata('gift', 'piggyvest_wallet')).toEqual(
      {}
    );
  });
});
