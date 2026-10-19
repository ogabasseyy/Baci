import { describe, expect, it, vi } from 'vitest';
import { loadOrderGiglInternalCreditRetainedAmount } from './load-order-gigl-internal-credit-retained-amount';

function mockRpc(amount: number | null) {
  return vi.fn().mockResolvedValue({ data: amount, error: null });
}

describe('loadOrderGiglInternalCreditRetainedAmount', () => {
  it('sums completed wallet payment amounts as retention evidence', async () => {
    const rpc = mockRpc(2500);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
        }
      )
    ).resolves.toBe(2500);

    expect(rpc).toHaveBeenCalledWith(
      'get_order_gigl_internal_credit_retained_amount',
      {
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
      }
    );
  });

  it('bugfix: treats store_credit and savings payments as retention evidence', async () => {
    const rpc = mockRpc(1800);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 1800,
        }
      )
    ).resolves.toBe(1800);
  });

  it('bugfix: caps evidence at credited amounts instead of the full stamped tariff', async () => {
    const rpc = mockRpc(500);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 3200,
        }
      )
    ).resolves.toBe(500);
  });

  it('returns 0 when no internal-credit payment exists', async () => {
    const rpc = mockRpc(0);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
        }
      )
    ).resolves.toBe(0);
  });

  it('bugfix: includes partial wallet/savings ledgers via authorized projection', async () => {
    // Mixed checkout: amountDueToGateway > 0 skips finalize_* RPCs, so only
    // redemption ledgers exist for the already-controlled credit portion.
    const rpc = mockRpc(1500);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 3200,
        }
      )
    ).resolves.toBe(1500);

    expect(rpc).toHaveBeenCalledWith(
      'get_order_gigl_internal_credit_retained_amount',
      expect.any(Object)
    );
  });

  it('returns 0 when funding source is not customer_checkout', async () => {
    const rpc = mockRpc(2500);

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'merchant_wallet',
          shipping_platform_retained_amount: 2500,
        }
      )
    ).resolves.toBe(0);

    expect(rpc).not.toHaveBeenCalled();
  });

  it('bugfix: fails closed when the authorized projection errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });

    await expect(
      loadOrderGiglInternalCreditRetainedAmount(
        { rpc } as never,
        'merchant-1',
        'order-1',
        {
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
        }
      )
    ).rejects.toThrow(/permission denied/);
  });
});
