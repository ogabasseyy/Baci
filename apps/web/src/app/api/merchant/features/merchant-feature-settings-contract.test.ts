import { describe, expect, it } from 'vitest';
import { INTEGRATION_SECRET_FIELDS } from '@/lib/integration-secret-settings';
import {
  buildReadOnlyDefaultFeatureSettings,
  merchantFeatureSelectFields,
} from './merchant-feature-settings-contract';

describe('merchant feature settings contract', () => {
  it('builds a complete read-only default record for the requested merchant', () => {
    const settings = buildReadOnlyDefaultFeatureSettings('merchant-1');

    expect(settings).toMatchObject({
      id: null,
      merchant_id: 'merchant-1',
      created_at: null,
      updated_at: null,
      paystack_enabled: true,
    });
    expect(Object.keys(settings).sort()).toEqual(
      [...merchantFeatureSelectFields].sort()
    );
  });

  it('binds the absent-settings defaults to each requested merchant', () => {
    const first = buildReadOnlyDefaultFeatureSettings('merchant-1');
    const second = buildReadOnlyDefaultFeatureSettings('merchant-2');

    expect(first.merchant_id).toBe('merchant-1');
    expect(second).toMatchObject({
      merchant_id: 'merchant-2',
      custom_settings: {},
    });
  });

  describe('bugfix R2: secret columns are never selected through the API', () => {
    it('excludes every integration secret from the select list', () => {
      for (const secret of INTEGRATION_SECRET_FIELDS) {
        expect(merchantFeatureSelectFields).not.toContain(secret);
      }
    });

    it('keeps the non-secret fields the dashboard reads', () => {
      expect(merchantFeatureSelectFields).toEqual(
        expect.arrayContaining([
          'merchant_id',
          'google_analytics_id',
          'facebook_pixel_id',
          'custom_settings',
        ])
      );
    });

    it('does not put secret keys in the read-only default record', () => {
      const settings = buildReadOnlyDefaultFeatureSettings('merchant-1');
      for (const secret of INTEGRATION_SECRET_FIELDS) {
        expect(settings).not.toHaveProperty(secret);
      }
    });
  });
});
