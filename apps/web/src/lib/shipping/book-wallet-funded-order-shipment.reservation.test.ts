import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./merchant-shipping-charge', () => ({
  reserveMerchantShippingCharge: vi.fn(),
  beginMerchantShippingChargeSubmission: vi.fn(),
  completeMerchantShippingCharge: vi.fn(),
  recoverMerchantShippingChargeForPersistedShipment: vi.fn(),
  refundMerchantShippingCharge: vi.fn(),
  markMerchantShippingChargeForReconciliation: vi.fn(),
}));

import { supabaseFixture } from './book-wallet-funded-order-shipment.test-support';
import { bookWalletOrCustomerCheckout } from './book-wallet-or-customer-checkout';
import * as charge from './merchant-shipping-charge';

describe('wallet-funded shipment orchestration — reservation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('reserves before booking and completes after persistence', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c1',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'a'.repeat(64),
    });
    const book = vi.fn().mockResolvedValue({ shipmentId: 's1' });
    await bookWalletOrCustomerCheckout(
      supabaseFixture,
      'm1',
      'o1',
      'q1',
      'merchant_wallet',
      book
    );
    expect(
      vi.mocked(charge.beginMerchantShippingChargeSubmission).mock
        .invocationCallOrder[0]
    ).toBeLessThan(book.mock.invocationCallOrder[0]);
    expect(charge.completeMerchantShippingCharge).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      'a'.repeat(64),
      's1'
    );
  });

  it('refreshes the quote before reserving wallet funds', async () => {
    const events: string[] = [];
    vi.mocked(charge.reserveMerchantShippingCharge).mockImplementation(
      async (_supabase, _orderId, quoteId) => {
        events.push(`reserve:${quoteId}`);
        return {
          charge: {
            chargeId: 'c-refresh',
            chargedAmount: 100,
            balanceAfter: 0,
            status: 'reserved',
          },
          token: 'q'.repeat(64),
        };
      }
    );
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockImplementation(
      async () => {
        events.push('begin');
        return 'provider_submitting';
      }
    );
    const prepareQuote = vi.fn(async () => {
      events.push('refresh');
      return 'q-fresh';
    });
    const book = vi.fn(async (quoteId?: string) => {
      events.push(`book:${quoteId}`);
      return {
        shipmentId: 's-refresh',
        provider: 'GIGL' as const,
        providerShipmentId: 'p-refresh',
        trackingNumber: 't-refresh',
        carrierName: 'GIGL',
        quoteId: 'q-fresh',
        estimatedDays: null,
        shipmentStatus: 'booked' as const,
      };
    });

    await bookWalletOrCustomerCheckout(
      supabaseFixture,
      'm1',
      'o1',
      'q-stale',
      'merchant_wallet',
      book,
      undefined,
      prepareQuote
    );

    expect(prepareQuote).toHaveBeenCalledOnce();
    expect(events).toEqual([
      'refresh',
      'reserve:q-fresh',
      'begin',
      'book:q-fresh',
    ]);
  });

  it('rotates an existing reservation before refreshing an expired quote', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as typeof supabaseFixture;
    const prepareQuote = vi
      .fn()
      .mockRejectedValue(new Error('quote replacement required'));
    const book = vi.fn().mockResolvedValue({ shipmentId: 's-existing' });
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'charge-existing',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabase,
        'm1',
        'o1',
        'q-expired',
        'merchant_wallet',
        book,
        undefined,
        prepareQuote
      )
    ).rejects.toThrow('quote replacement required');

    expect(rpc).toHaveBeenCalledWith('has_active_merchant_shipping_charge', {
      p_order_id: 'o1',
      p_quote_id: 'q-expired',
    });
    expect(prepareQuote).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).toHaveBeenCalledWith(
      supabase,
      'o1',
      'q-expired'
    );
    expect(charge.refundMerchantShippingCharge).toHaveBeenCalledWith(
      supabase,
      'charge-existing',
      'r'.repeat(64),
      'QUOTE_REFRESH_FAILED'
    );
    expect(book).not.toHaveBeenCalled();
  });
});
