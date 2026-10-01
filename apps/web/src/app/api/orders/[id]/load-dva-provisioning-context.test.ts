import { describe, expect, it, vi } from 'vitest';
import { loadDvaProvisioningContext } from './load-dva-provisioning-context';

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder = Object.assign(Promise.resolve(result), {
    eq: vi.fn(() => builder),
    in: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  });
  return builder;
}

function client({
  payableAmount = 5_000,
  settings = { paystack_enabled: true },
}: {
  payableAmount?: number;
  settings?: unknown;
} = {}) {
  const settingsQuery = query(settings);
  const paymentAccountQuery = query(null);
  return {
    rpc: vi.fn().mockResolvedValue({ data: payableAmount, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'merchant_feature_settings') return settingsQuery;
      return paymentAccountQuery;
    }),
  };
}

describe('loadDvaProvisioningContext', () => {
  it('rejects automatic confirmation when Paystack is disabled', async () => {
    const result = await loadDvaProvisioningContext({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: client({ settings: { paystack_enabled: false } }) as never,
    });

    expect(result).toMatchObject({ code: 'GATEWAY_DISABLED', ok: false });
  });

  it('uses the authoritative locked balance returned by the database', async () => {
    const supabase = client({ payableAmount: 5_000 });
    const result = await loadDvaProvisioningContext({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabase as never,
    });

    expect(result).toEqual({ ok: true, payableAmount: 5_000 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'refresh_paystack_order_payable_amount',
      { p_order_id: 'order-1' }
    );
  });

  it('rejects provisioning when reconciled payments cover the order', async () => {
    const result = await loadDvaProvisioningContext({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: client({ payableAmount: 0 }) as never,
    });

    expect(result).toMatchObject({ code: 'NO_PAYABLE_AMOUNT', ok: false });
  });
});
