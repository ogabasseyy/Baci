import { describe, expect, it, vi } from 'vitest';
import {
  findCheckoutCustomerId,
  getVtuCheckoutSettings,
  linkCheckoutCustomerByEmail,
} from './vtu-checkout-customer-rpcs';

function buildSupabase(
  rpcImpl: (fn: string) => { data: unknown; error: { message: string } | null }
) {
  const rpc = vi.fn((fn: string) => Promise.resolve(rpcImpl(fn)));
  return { rpc, supabase: { rpc } as never };
}

const SETTINGS_ROW = {
  vtu_enabled: true,
  vtu_airtime_enabled: true,
  vtu_data_enabled: false,
  vtu_electricity_enabled: true,
  vtu_tv_enabled: false,
  vtu_betting_enabled: false,
  vtu_merchant_commission_rate: 50,
  vtu_customer_cashback_enabled: true,
  vtu_customer_cashback_rate: 10,
  paystack_enabled: true,
  korapay_enabled: false,
};

const LINKED_ROW = {
  id: 'customer-1',
  email: 'c@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone: '08030000001',
  user_id: 'user-1',
};

describe('findCheckoutCustomerId', () => {
  it('returns the id on a hit', async () => {
    const { rpc, supabase } = buildSupabase(() => ({
      data: 'customer-1',
      error: null,
    }));

    await expect(
      findCheckoutCustomerId(supabase, 'merchant-1', 'user-1')
    ).resolves.toBe('customer-1');
    expect(rpc).toHaveBeenCalledWith('find_vtu_customer_for_checkout', {
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
    });
  });

  it('returns null on a miss', async () => {
    const { supabase } = buildSupabase(() => ({ data: null, error: null }));

    await expect(
      findCheckoutCustomerId(supabase, 'merchant-1', 'user-1')
    ).resolves.toBeNull();
  });

  it('throws fail-closed on an RPC error', async () => {
    const { supabase } = buildSupabase(() => ({
      data: null,
      error: { message: 'boom' },
    }));

    await expect(
      findCheckoutCustomerId(supabase, 'merchant-1', 'user-1')
    ).rejects.toThrow(/Failed to look up VTU customer/);
  });
});

describe('linkCheckoutCustomerByEmail', () => {
  it('returns the full linked row', async () => {
    const { rpc, supabase } = buildSupabase(() => ({
      data: [LINKED_ROW],
      error: null,
    }));

    await expect(
      linkCheckoutCustomerByEmail(supabase, 'merchant-1', 'user-1')
    ).resolves.toEqual(LINKED_ROW);
    expect(rpc).toHaveBeenCalledWith('link_vtu_customer_by_email', {
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
    });
  });

  it('returns null on zero rows (no link)', async () => {
    const { supabase } = buildSupabase(() => ({ data: [], error: null }));

    await expect(
      linkCheckoutCustomerByEmail(supabase, 'merchant-1', 'user-1')
    ).resolves.toBeNull();
  });

  it('throws fail-closed on an RPC error', async () => {
    const { supabase } = buildSupabase(() => ({
      data: null,
      error: { message: 'boom' },
    }));

    await expect(
      linkCheckoutCustomerByEmail(supabase, 'merchant-1', 'user-1')
    ).rejects.toThrow(/Failed to look up VTU customer/);
  });
});

describe('getVtuCheckoutSettings', () => {
  it('returns the projection row', async () => {
    const { rpc, supabase } = buildSupabase(() => ({
      data: [SETTINGS_ROW],
      error: null,
    }));

    await expect(
      getVtuCheckoutSettings(supabase, 'merchant-1', 'user-1')
    ).resolves.toEqual(SETTINGS_ROW);
    expect(rpc).toHaveBeenCalledWith('get_vtu_checkout_settings', {
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
    });
  });

  it('returns null on zero rows (not-a-member or no row)', async () => {
    const { supabase } = buildSupabase(() => ({ data: [], error: null }));

    await expect(
      getVtuCheckoutSettings(supabase, 'merchant-1', 'user-1')
    ).resolves.toBeNull();
  });

  it('throws the raw message on a transport error (caller adds context)', async () => {
    const { supabase } = buildSupabase(() => ({
      data: null,
      error: { message: 'boom' },
    }));

    await expect(
      getVtuCheckoutSettings(supabase, 'merchant-1', 'user-1')
    ).rejects.toThrow('boom');
  });
});
