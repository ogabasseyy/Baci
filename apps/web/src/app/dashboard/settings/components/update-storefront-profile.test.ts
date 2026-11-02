import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc }),
}));

import { updateStorefrontProfile } from './update-storefront-profile';

describe('updateStorefrontProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the guarded tenant-scoped RPC with the current concurrency token', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'merchant-a',
        site_description: 'Quality products for everyday life.',
        support_email: 'support@example.com',
        support_phone: '+2348000000000',
        updated_at: '2026-08-04T06:00:00.000Z',
      },
      error: null,
    });

    await expect(
      updateStorefrontProfile({
        merchantId: 'merchant-a',
        expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
        settings: {
          site_description: 'Quality products for everyday life.',
          support_email: 'support@example.com',
          support_phone: '+2348000000000',
        },
      })
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('update_merchant_identity_settings', {
      p_merchant_id: 'merchant-a',
      p_expected_updated_at: '2026-08-04T05:00:00.000Z',
      p_settings: {
        site_description: 'Quality products for everyday life.',
        support_email: 'support@example.com',
        support_phone: '+2348000000000',
      },
    });
  });

  it('does not report a successful save when the guarded RPC rejects it', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: new Error('merchant_settings_conflict'),
    });

    await expect(
      updateStorefrontProfile({
        merchantId: 'merchant-a',
        expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
        settings: { site_description: 'Updated description' },
      })
    ).rejects.toThrow('merchant_settings_conflict');
  });

  it('sends the business phone and explains a sign-in the database requires', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'merchant_settings_reauthentication_required' },
    });

    await expect(
      updateStorefrontProfile({
        merchantId: 'merchant-a',
        expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
        settings: { phone: '+2348031234567' },
      })
    ).rejects.toThrow('Sign in again before changing your contact details.');

    expect(rpc).toHaveBeenCalledWith(
      'update_merchant_identity_settings',
      expect.objectContaining({ p_settings: { phone: '+2348031234567' } })
    );
  });
});
