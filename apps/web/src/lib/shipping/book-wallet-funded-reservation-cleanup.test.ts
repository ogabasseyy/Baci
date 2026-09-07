import { describe, expect, it, vi } from 'vitest';
import { hasActiveMerchantShippingCharge } from './book-wallet-funded-reservation-cleanup';

describe('hasActiveMerchantShippingCharge', () => {
  it('returns false when the client cannot query the projection', async () => {
    await expect(
      hasActiveMerchantShippingCharge({} as never, 'o1', 'q1')
    ).resolves.toBe(false);
  });

  it('bugfix: treats provider_submitting charges as active before quote refresh', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      hasActiveMerchantShippingCharge({ rpc } as never, 'order-1', 'quote-1')
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('has_active_merchant_shipping_charge', {
      p_order_id: 'order-1',
      p_quote_id: 'quote-1',
    });
  });

  it('bugfix: uses staff-authorized RPC instead of owner-only table reads', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn();

    await expect(
      hasActiveMerchantShippingCharge(
        { rpc, from } as never,
        'order-1',
        'quote-1'
      )
    ).resolves.toBe(true);

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('has_active_merchant_shipping_charge', {
      p_order_id: 'order-1',
      p_quote_id: 'quote-1',
    });
  });

  it('returns null when the projection errors so callers fail closed to reserve', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });

    await expect(
      hasActiveMerchantShippingCharge({ rpc } as never, 'order-1', 'quote-1')
    ).resolves.toBeNull();
  });
});
