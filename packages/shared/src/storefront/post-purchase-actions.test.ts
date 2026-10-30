import {
  BACI_GOOGLE_REVIEW_URL,
  CUSTOMER_CANCELLATION_REASONS,
  canCancelStorefrontOrder,
  canLeaveStorefrontGoogleReview,
  canRequestStorefrontOrderReturn,
  canShowStorefrontRiderContact,
  isStorefrontReceiptAvailable,
} from './post-purchase-actions';

describe('post-purchase-actions', () => {
  it('exposes the storefront Google review link', () => {
    expect(BACI_GOOGLE_REVIEW_URL).toBe(
      'https://g.page/r/CR1gsFYL8eu9EBM/review'
    );
  });

  it('only marks paid shipped or delivered orders as receipt-ready', () => {
    expect(
      isStorefrontReceiptAvailable({
        paymentStatus: 'paid',
        shippingStatus: 'shipped',
      })
    ).toBe(true);
    expect(
      isStorefrontReceiptAvailable({
        paymentStatus: 'paid',
        shippingStatus: 'delivered',
      })
    ).toBe(true);
    expect(
      isStorefrontReceiptAvailable({
        paymentStatus: 'pending',
        shippingStatus: 'shipped',
      })
    ).toBe(false);
    expect(
      isStorefrontReceiptAvailable({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
      })
    ).toBe(false);
  });

  it('shows rider contact only while the order is actively en route', () => {
    expect(canShowStorefrontRiderContact('shipped')).toBe(true);
    expect(canShowStorefrontRiderContact('out_for_delivery')).toBe(true);
    expect(canShowStorefrontRiderContact('delivered')).toBe(false);
    expect(canShowStorefrontRiderContact('pending')).toBe(false);
  });

  it('only enables review and return actions after delivery', () => {
    expect(canLeaveStorefrontGoogleReview('delivered')).toBe(true);
    expect(canRequestStorefrontOrderReturn('delivered')).toBe(true);
    expect(canLeaveStorefrontGoogleReview('shipped')).toBe(false);
    expect(canRequestStorefrontOrderReturn('shipped')).toBe(false);
  });

  describe('canCancelStorefrontOrder', () => {
    it('allows cancellation only while unpaid and not yet shipped', () => {
      expect(
        canCancelStorefrontOrder({
          shippingStatus: 'pending',
          paymentStatus: 'unpaid',
        })
      ).toBe(true);
      expect(
        canCancelStorefrontOrder({
          shippingStatus: 'processing',
          paymentStatus: 'unpaid',
        })
      ).toBe(true);
    });

    it('blocks cancellation once the order is shipped or beyond', () => {
      for (const shippingStatus of [
        'shipped',
        'delivered',
        'cancelled',
        'returned',
      ]) {
        expect(
          canCancelStorefrontOrder({ shippingStatus, paymentStatus: 'unpaid' })
        ).toBe(false);
      }
    });

    it('blocks cancellation for any non-unpaid payment status', () => {
      for (const paymentStatus of [
        'paid',
        'pending',
        'partially_paid',
        'refunded',
        'bnpl_approved',
      ]) {
        expect(
          canCancelStorefrontOrder({ shippingStatus: 'pending', paymentStatus })
        ).toBe(false);
      }
    });

    it('normalizes casing and whitespace', () => {
      expect(
        canCancelStorefrontOrder({
          shippingStatus: '  Pending ',
          paymentStatus: 'UNPAID',
        })
      ).toBe(true);
    });

    it('returns false for missing statuses', () => {
      expect(
        canCancelStorefrontOrder({
          shippingStatus: null,
          paymentStatus: undefined,
        })
      ).toBe(false);
    });
  });

  describe('CUSTOMER_CANCELLATION_REASONS', () => {
    it('exposes a non-empty list of selectable reasons including an Other escape hatch', () => {
      expect(CUSTOMER_CANCELLATION_REASONS.length).toBeGreaterThan(0);
      expect(CUSTOMER_CANCELLATION_REASONS).toContain('Other');
    });

    it('contains only unique reasons', () => {
      expect(new Set(CUSTOMER_CANCELLATION_REASONS).size).toBe(
        CUSTOMER_CANCELLATION_REASONS.length
      );
    });
  });
});
