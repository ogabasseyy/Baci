import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrimaryCustomerSavingsFeatureSettings } from './customer-savings-feature-settings';

describe('getPrimaryCustomerSavingsFeatureSettings', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
  });

  it('maps the settings row with the shared.ts contract', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          customer_device_savings_auto_debit_enabled: true,
          customer_device_savings_enabled: true,
          paystack_enabled: null,
        },
      ],
      error: null,
    });
    await expect(
      getPrimaryCustomerSavingsFeatureSettings({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        supabase: { rpc } as never,
      })
    ).resolves.toEqual({
      autoDebitEnabled: true,
      paystackEnabled: true,
      savingsEnabled: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'get_customer_savings_feature_settings',
      { p_customer_id: 'customer-1', p_merchant_id: 'merchant-1' }
    );
  });

  it('fails closed when savings is disabled or the row is missing', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          customer_device_savings_auto_debit_enabled: false,
          customer_device_savings_enabled: false,
          paystack_enabled: false,
        },
      ],
      error: null,
    });
    await expect(
      getPrimaryCustomerSavingsFeatureSettings({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        supabase: { rpc } as never,
      })
    ).resolves.toEqual({
      autoDebitEnabled: false,
      paystackEnabled: false,
      savingsEnabled: false,
    });
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      getPrimaryCustomerSavingsFeatureSettings({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        supabase: { rpc } as never,
      })
    ).resolves.toMatchObject({ savingsEnabled: false });
  });

  it('propagates RPC errors instead of defaulting open', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(
      getPrimaryCustomerSavingsFeatureSettings({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        supabase: { rpc } as never,
      })
    ).rejects.toThrow('db down');
  });
});
