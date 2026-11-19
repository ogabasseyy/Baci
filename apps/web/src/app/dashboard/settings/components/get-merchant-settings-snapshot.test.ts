import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from }),
}));

import { getMerchantSettingsSnapshot } from './get-merchant-settings-snapshot';

describe('getMerchantSettingsSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the complete canonical profile through the selected merchant scope', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Merchant A',
        country: 'NG',
        phone: '+2348012345678',
        site_description: 'Useful goods.',
        support_email: 'support@example.com',
        support_phone: '+2348000000000',
        updated_at: '2026-08-04T06:00:00.000Z',
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(getMerchantSettingsSnapshot('merchant-a')).resolves.toEqual({
      business_name: 'Merchant A',
      country: 'NG',
      phone: '+2348012345678',
      site_description: 'Useful goods.',
      support_email: 'support@example.com',
      support_phone: '+2348000000000',
      updated_at: '2026-08-04T06:00:00.000Z',
    });

    expect(from).toHaveBeenCalledWith('merchants');
    expect(select).toHaveBeenCalledWith(
      'business_name, country, phone, site_description, support_email, support_phone, updated_at'
    );
    expect(eq).toHaveBeenCalledWith('id', 'merchant-a');
  });

  it('rejects a profile that lacks the concurrency token', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Merchant A',
        country: 'NG',
        site_description: null,
        support_email: null,
        support_phone: null,
        updated_at: null,
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(getMerchantSettingsSnapshot('merchant-a')).rejects.toThrow(
      'Store settings changed. Reload before saving again.'
    );
  });
});
