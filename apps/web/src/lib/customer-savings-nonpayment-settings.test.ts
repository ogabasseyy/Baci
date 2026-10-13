import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getCustomerSavingsNonpaymentSettings } from './customer-savings-nonpayment-settings';

const scope = {
  customerId: '11111111-1111-4111-8111-111111111111',
  merchantId: '22222222-2222-4222-8222-222222222222',
};
describe('nonpayment savings feature settings', () => {
  it.each([
    true,
    false,
    null,
  ])('projects only savings enablement %s through scoped RPC', async (enabled) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { customer_device_savings_enabled: enabled, paystack_enabled: true },
      ],
      error: null,
    });
    expect(
      await getCustomerSavingsNonpaymentSettings({
        ...scope,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).toEqual({ savingsEnabled: enabled === true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'get_customer_savings_feature_settings',
      { p_customer_id: scope.customerId, p_merchant_id: scope.merchantId }
    );
  });
  it('disables savings for no settings row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    expect(
      await getCustomerSavingsNonpaymentSettings({
        ...scope,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).toEqual({ savingsEnabled: false });
  });
  it.each([
    null,
    [{}],
    [{ customer_device_savings_enabled: 'true' }],
    [
      { customer_device_savings_enabled: true },
      { customer_device_savings_enabled: true },
    ],
  ])('rejects malformed or ambiguous settings rows', async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(
      getCustomerSavingsNonpaymentSettings({
        ...scope,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow('Unable to read savings settings');
  });
  it('validates scope before invoking storage', async () => {
    const rpc = vi.fn();
    await expect(
      getCustomerSavingsNonpaymentSettings({
        ...scope,
        customerId: '',
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('redacts RPC errors', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'private' } });
    await expect(
      getCustomerSavingsNonpaymentSettings({
        ...scope,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow(/^Unable to read savings settings$/);
  });
});
