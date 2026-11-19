import { describe, expect, it, vi } from 'vitest';
import { redeemImeiWalletPayment } from './redeem-imei-wallet-payment';

describe('redeemImeiWalletPayment', () => {
  it.each([
    null,
    { code: '42501', message: 'scope denied' },
  ])('preserves scoped identity and propagates errors without retries: %j', async (error) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const result = redeemImeiWalletPayment({
      amount: 500,
      customerId: 'customer',
      lookupId: 'lookup',
      merchantId: 'merchant',
      supabaseAdmin: { rpc },
    });
    if (error) await expect(result).rejects.toBe(error);
    else await expect(result).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'redeem_imei_wallet_payment',
      expect.objectContaining({
        p_amount: 500,
        p_customer_id: 'customer',
        p_lookup_id: 'lookup',
        p_merchant_id: 'merchant',
      })
    );
  });
});
