import { describe, expect, it } from 'vitest';
import type { MerchantData } from '@/hooks/merchant';
import { getIntegrationStatus } from './integration-status';

function makeMerchant(overrides: Partial<MerchantData> = {}): MerchantData {
  return {
    business_name: 'Test Store',
    business_type: 'retail',
    id: 'merchant-1',
    user_id: 'user-1',
    ...overrides,
  };
}

describe('getIntegrationStatus', () => {
  it('marks an integration active when all required settings are present', () => {
    const merchant = makeMerchant({
      feature_settings: {
        facebook_pixel_id: '1234567890',
        facebook_capi_token: 'token',
      },
    });

    expect(getIntegrationStatus('facebook', merchant)).toMatchObject({
      actionLabel: 'Manage',
      label: 'Active',
      state: 'active',
    });
  });

  it('marks an integration partial when only some required settings are present', () => {
    const merchant = makeMerchant({
      feature_settings: {
        tiktok_pixel_id: 'CT123',
        tiktok_access_token: null,
      },
    });

    expect(getIntegrationStatus('tiktok', merchant)).toMatchObject({
      actionLabel: 'Finish setup',
      label: 'Partial',
      state: 'partial',
    });
  });

  it('marks a known integration not configured when no required settings are present', () => {
    const merchant = makeMerchant({
      feature_settings: {},
    });

    expect(getIntegrationStatus('facebook', merchant)).toMatchObject({
      actionLabel: 'Configure',
      label: 'Not configured',
      state: 'not_configured',
    });
  });

  it('marks unknown integrations not configured', () => {
    const merchant = makeMerchant();

    expect(getIntegrationStatus('unknown-integration', merchant)).toMatchObject(
      {
        actionLabel: 'Configure',
        label: 'Not configured',
        state: 'not_configured',
      }
    );
  });

  it('treats whitespace-only setting values as empty', () => {
    const merchant = makeMerchant({
      feature_settings: {
        facebook_pixel_id: '   ',
        facebook_capi_token: 'token',
      },
    });

    expect(getIntegrationStatus('facebook', merchant)).toMatchObject({
      actionLabel: 'Finish setup',
      label: 'Partial',
      state: 'partial',
    });
  });

  it('falls back to legacy merchant columns when feature settings are empty', () => {
    const merchant = makeMerchant({
      twitter_pixel_id: 'tw-pixel',
      feature_settings: {},
    });

    expect(getIntegrationStatus('twitter', merchant)).toMatchObject({
      actionLabel: 'Manage',
      label: 'Active',
      state: 'active',
    });
  });

  it('does not claim Google Merchant Center is externally connected', () => {
    const merchant = makeMerchant();

    expect(getIntegrationStatus('google-merchant', merchant)).toMatchObject({
      actionLabel: 'Setup guide',
      label: 'Feed ready',
      state: 'feed_ready',
    });
  });

  it('labels Muse as owners-only instead of claiming a connection state', () => {
    const merchant = makeMerchant();

    expect(getIntegrationStatus('muse', merchant)).toMatchObject({
      actionLabel: 'Open',
      label: 'Owners only',
      state: 'partial',
    });
  });
});
