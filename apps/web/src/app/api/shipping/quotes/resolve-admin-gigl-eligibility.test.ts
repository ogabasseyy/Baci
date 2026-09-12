import { describe, expect, it, vi } from 'vitest';
import { resolveAdminGiglEligibility } from './resolve-admin-gigl-eligibility';

function client({
  merchant = { country: 'NG', payout_currency: 'NGN' },
  merchantError = null,
  settings = { shipping_providers: ['gigl'] },
  settingsError = null,
}: {
  merchant?: unknown;
  merchantError?: unknown;
  settings?: unknown;
  settingsError?: unknown;
} = {}) {
  const merchantQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: merchant,
      error: merchantError,
    }),
  };
  const settingsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: settings,
      error: settingsError,
    }),
  };
  return {
    from: vi.fn((table: string) =>
      table === 'merchants' ? merchantQuery : settingsQuery
    ),
  } as never;
}

describe('resolveAdminGiglEligibility', () => {
  it('allows a Nigerian NGN merchant with GIGL enabled', async () => {
    await expect(
      resolveAdminGiglEligibility(client(), 'merchant-1')
    ).resolves.toEqual({ ok: true });
  });

  it('treats a legacy null country as Nigeria when payout currency is NGN', async () => {
    await expect(
      resolveAdminGiglEligibility(
        client({ merchant: { country: null, payout_currency: 'NGN' } }),
        'merchant-1'
      )
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a disabled provider or a non-Nigerian merchant', async () => {
    await expect(
      resolveAdminGiglEligibility(
        client({ settings: { shipping_providers: ['topship'] } }),
        'merchant-1'
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 422,
      body: { code: 'GIGL_PROVIDER_DISABLED' },
    });
    await expect(
      resolveAdminGiglEligibility(
        client({ merchant: { country: 'GH', payout_currency: 'GHS' } }),
        'merchant-1'
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 422,
      body: { code: 'GIGL_MERCHANT_INELIGIBLE' },
    });
  });

  it('applies the canonical provider default for missing settings or null providers', async () => {
    await expect(
      resolveAdminGiglEligibility(client({ settings: null }), 'merchant-1')
    ).resolves.toEqual({ ok: true });
    await expect(
      resolveAdminGiglEligibility(
        client({ settings: { shipping_providers: null } }),
        'merchant-1'
      )
    ).resolves.toEqual({ ok: true });
  });

  it('keeps an explicit empty provider list disabled', async () => {
    await expect(
      resolveAdminGiglEligibility(
        client({ settings: { shipping_providers: [] } }),
        'merchant-1'
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 422,
      body: { code: 'GIGL_PROVIDER_DISABLED' },
    });
  });

  it('returns 500 when the feature-settings lookup fails', async () => {
    await expect(
      resolveAdminGiglEligibility(
        client({ settingsError: { message: 'timeout' } }),
        'merchant-1'
      )
    ).resolves.toEqual({
      ok: false,
      status: 500,
      body: { error: 'Failed to resolve merchant eligibility' },
    });
  });
});
