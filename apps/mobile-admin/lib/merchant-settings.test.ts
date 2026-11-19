import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateMerchantIdentitySettings,
  updateMerchantSettings,
} from './merchant-settings';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  rpc: vi.fn(),
}));

const committedIdentitySettings = {
  id: 'merchant-1',
  business_address: '12 Allen Avenue',
  business_name: 'Baci Store',
  country: 'NG',
  payout_currency: 'NGN',
  phone: null,
  slug: 'baci-store',
  support_email: 'owner@example.com',
  support_phone: '+2348012345678',
  updated_at: '2026-07-30T20:00:00.000Z',
};

vi.mock('./supabase', () => ({
  supabase: { rpc: mocks.rpc },
}));

vi.mock('./api-client', () => ({
  apiClient: mocks.apiClient,
}));

describe('merchant settings mutation clients', () => {
  beforeEach(() => {
    mocks.apiClient.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: committedIdentitySettings,
      error: null,
    });
  });

  it('sends the active merchant ID with the settings payload', async () => {
    mocks.apiClient.mockResolvedValueOnce({
      merchant: { id: 'merchant-2' },
    });

    await updateMerchantSettings('merchant-2', {
      social_media: { instagram: '@second-store' },
    });

    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/merchant/settings',
      expect.objectContaining({ method: 'PATCH' })
    );
    const request = mocks.apiClient.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      social_media: { instagram: '@second-store' },
      merchantId: 'merchant-2',
    });
  });

  it('does not let a payload override the asserted merchant ID', async () => {
    mocks.apiClient.mockResolvedValueOnce({
      merchant: { id: 'merchant-2' },
    });

    await updateMerchantSettings('merchant-2', {
      merchantId: 'merchant-1',
      social_media: { instagram: '@second-store' },
    } as Parameters<typeof updateMerchantSettings>[1] & {
      merchantId: string;
    });

    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/merchant/settings',
      expect.objectContaining({ method: 'PATCH' })
    );
    const request = mocks.apiClient.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      social_media: { instagram: '@second-store' },
      merchantId: 'merchant-2',
    });
  });

  it('uses the guarded RPC instead of a direct merchants update', async () => {
    await updateMerchantIdentitySettings({
      expectedUpdatedAt: '2026-07-29T10:00:00Z',
      merchantId: 'merchant-1',
      settings: { support_email: 'support@example.com' },
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_merchant_identity_settings',
      {
        p_expected_updated_at: '2026-07-29T10:00:00Z',
        p_merchant_id: 'merchant-1',
        p_settings: { support_email: 'support@example.com' },
      }
    );
  });

  it('returns an immutable committed receipt with server-normalized form values', async () => {
    const receipt = await updateMerchantIdentitySettings({
      expectedUpdatedAt: '2026-07-29T10:00:00Z',
      merchantId: 'merchant-1',
      settings: {
        business_name: '  Baci Store  ',
        payout_currency: ' ngn ',
        phone: '   ',
        support_email: ' Owner@Example.COM ',
      },
    });

    expect(receipt).toEqual({
      merchantId: 'merchant-1',
      savedValues: {
        business_address: '12 Allen Avenue',
        business_name: 'Baci Store',
        country: 'NG',
        payout_currency: 'NGN',
        phone: '',
        slug: 'baci-store',
        support_email: 'owner@example.com',
        support_phone: '+2348012345678',
      },
      updatedAt: '2026-07-30T20:00:00.000Z',
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.savedValues)).toBe(true);
  });

  it('accepts a committed receipt with extra response columns', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...committedIdentitySettings, unexpected: 'unsafe' },
      error: null,
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { business_name: 'Baci Store' },
      })
    ).resolves.toMatchObject({ merchantId: 'merchant-1' });
  });

  it('rejects a committed receipt missing an expected identity key', async () => {
    const { country: _country, ...receiptWithoutCountry } =
      committedIdentitySettings;
    mocks.rpc.mockResolvedValueOnce({
      data: receiptWithoutCountry,
      error: null,
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { business_name: 'Baci Store' },
      })
    ).rejects.toThrow('Invalid store settings update response');
  });

  it.each([
    ['an invalid update timestamp', { updated_at: 'not-a-timestamp' }],
    ['a non-string identity field', { support_phone: 2348012345678 }],
  ])('rejects a committed receipt with %s', async (_caseName, override) => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...committedIdentitySettings, ...override },
      error: null,
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { business_name: 'Baci Store' },
      })
    ).rejects.toThrow('Invalid store settings update response');
  });

  it('requires a fresh login when the server rejects a stale session', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'merchant_settings_reauthentication_required' },
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { phone: '+2348012345678' },
      })
    ).rejects.toThrow('sign out and sign back in');
  });

  it('surfaces the MFA step-up requirement', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'merchant_settings_mfa_required' },
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { support_phone: '+2348012345678' },
      })
    ).rejects.toThrow('Multi-factor authentication is required');
  });

  it('surfaces an optimistic-concurrency conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'merchant_settings_conflict' },
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { business_name: 'Updated Store' },
      })
    ).rejects.toThrow('These settings changed elsewhere');
  });

  it('explains a phone number the database refuses', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'invalid_support_phone' },
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { phone: '+23415781' },
      })
    ).rejects.toThrow(
      'Enter the full phone number with its country code, for example +234 801 234 5678.'
    );
  });

  it('preserves an unexpected database error message', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unexpected database failure' },
    });

    await expect(
      updateMerchantIdentitySettings({
        expectedUpdatedAt: '2026-07-29T10:00:00Z',
        merchantId: 'merchant-1',
        settings: { country: 'NG' },
      })
    ).rejects.toThrow('unexpected database failure');
  });
});
