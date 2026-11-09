import { describe, expect, it, vi } from 'vitest';
import {
  assertGiglCustomerCheckoutPrepaid,
  hasGiglCheckoutShippingRetention,
  isPayOnDeliveryPaymentMethod,
} from './assert-gigl-customer-checkout-prepaid';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

const settledContext = {
  supabase: { from: vi.fn() } as never,
  merchantId: 'merchant-1',
  orderId: 'order-1',
  settledRetainedAmount: 2500,
};

describe('isPayOnDeliveryPaymentMethod', () => {
  it.each([
    'pod',
    'pay_on_delivery',
    'POD',
    ' Pay_On_Delivery ',
  ])('returns true for %s', (paymentMethod) => {
    expect(isPayOnDeliveryPaymentMethod(paymentMethod)).toBe(true);
  });

  it('returns false for prepaid gateway methods', () => {
    expect(isPayOnDeliveryPaymentMethod('paystack')).toBe(false);
  });
});

describe('hasGiglCheckoutShippingRetention', () => {
  it('requires customer_checkout funding with a positive retained amount', () => {
    expect(
      hasGiglCheckoutShippingRetention({
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 2500,
      })
    ).toBe(true);
  });

  it('does not treat Paystack/Korapay as retention proof when funding source is null', () => {
    expect(
      hasGiglCheckoutShippingRetention({
        shipping_funding_source: null,
        shipping_platform_retained_amount: 0,
      })
    ).toBe(false);
  });

  it('rejects customer_checkout without a positive retained amount', () => {
    expect(
      hasGiglCheckoutShippingRetention({
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 0,
      })
    ).toBe(false);
  });
});

describe('assertGiglCustomerCheckoutPrepaid', () => {
  it('allows wallet-funded GIGL bookings for unpaid pay-on-delivery orders', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'merchant_wallet',
        payment_status: 'unpaid',
        payment_method: 'pay_on_delivery',
      })
    ).resolves.toBeUndefined();
  });

  it('allows prepaid customer-checkout GIGL bookings with settled retention', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'paystack',
          shipping_platform_retained_amount: 2500,
        },
        settledContext
      )
    ).resolves.toBeUndefined();
  });

  it('bugfix: allows wallet-paid checkout GIGL when settlements are missing', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'merchant_settlements') {
        const eqSourceId = vi.fn().mockResolvedValue({
          data: [],
          error: null,
        });
        const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
        const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
        return {
          select: vi.fn(() => ({ eq: eqMerchant })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({ data: 2500, error: null });

    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'wallet',
          shipping_platform_retained_amount: 2500,
        },
        {
          supabase: { from, rpc } as never,
          merchantId: 'merchant-1',
          orderId: 'order-1',
        }
      )
    ).resolves.toBeUndefined();

    expect(from).not.toHaveBeenCalledWith('orders');
    expect(from).not.toHaveBeenCalledWith('customer_wallet_transactions');
    expect(from).not.toHaveBeenCalledWith('customer_savings_redemptions');
    expect(rpc).toHaveBeenCalledWith(
      'get_order_gigl_internal_credit_retained_amount',
      {
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
      }
    );
  });

  it('bugfix: rejects when internal-credit amount is below the stamped tariff', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'merchant_settlements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({ data: 500, error: null });

    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'wallet',
          shipping_platform_retained_amount: 2500,
        },
        {
          supabase: { from, rpc } as never,
          merchantId: 'merchant-1',
          orderId: 'order-1',
        }
      )
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('bugfix: rejects paid gateway orders when stamped retention is not settled', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'paystack',
          shipping_platform_retained_amount: 2500,
        },
        { ...settledContext, settledRetainedAmount: 0 }
      )
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('bugfix: rejects when cumulative settled retention is below the stamped amount', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'paystack',
          shipping_platform_retained_amount: 2500,
        },
        { ...settledContext, settledRetainedAmount: 1500 }
      )
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('bugfix: covers stamped retention when settlement and internal credit sum only in kobo', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'merchant_settlements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      status: 'completed',
                      metadata: { retained_shipping_amount: 1000.14 },
                    },
                  ],
                  error: null,
                }),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({ data: 1000, error: null });

    await expect(
      assertGiglCustomerCheckoutPrepaid(
        {
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'wallet',
          shipping_platform_retained_amount: 2000.14,
        },
        {
          supabase: { from, rpc } as never,
          merchantId: 'merchant-1',
          orderId: 'order-1',
        }
      )
    ).resolves.toBeUndefined();
  });

  it('bugfix: allows paid legacy GIGL orders when funding snapshot is absent', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: null,
        payment_status: 'paid',
        payment_method: 'paystack',
        shipping_platform_retained_amount: null,
      })
    ).resolves.toBeUndefined();
  });

  it('still rejects unpaid legacy GIGL orders with a null funding snapshot', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: null,
        payment_status: 'unpaid',
        payment_method: 'paystack',
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('still rejects pay-on-delivery legacy GIGL orders with a null funding snapshot', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: null,
        payment_status: 'paid',
        payment_method: 'pay_on_delivery',
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('rejects customer-checkout GIGL bookings paid with Credit Direct', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'paid',
        payment_method: 'credit_direct',
        shipping_platform_retained_amount: 0,
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('rejects manually paid customer-checkout GIGL bookings without retained shipping', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'paid',
        payment_method: 'manual',
        shipping_platform_retained_amount: 0,
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('rejects paid gateway checkouts that never retained GIGL shipping', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'paid',
        payment_method: 'paystack',
        shipping_platform_retained_amount: 0,
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('rejects customer-checkout GIGL bookings when payment is unpaid', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'unpaid',
        payment_method: 'paystack',
      })
    ).rejects.toBeInstanceOf(OrderShipmentBookingError);

    try {
      await assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'unpaid',
        payment_method: 'paystack',
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'GIGL_REQUIRES_PREPAID_OR_WALLET',
        status: 400,
      });
    }
  });

  it('rejects customer-checkout GIGL bookings for pay-on-delivery orders', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'paid',
        payment_method: 'pay_on_delivery',
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it('ignores non-GIGL providers', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'TOPSHIP',
        shipping_funding_source: 'customer_checkout',
        payment_status: 'unpaid',
        payment_method: 'pay_on_delivery',
      })
    ).resolves.toBeUndefined();
  });
});
