import { describe, expect, it } from 'vitest';
import { merchantFeatureSettingsPatchSchema } from './merchant-features';

describe('merchantFeatureSettingsPatchSchema', () => {
  it('keeps sparse updates from materializing Klump defaults', () => {
    const result = merchantFeatureSettingsPatchSchema.parse({
      loyalty_enabled: true,
    });

    expect(result).toEqual({
      loyalty_enabled: true,
    });
  });

  it('accepts explicit Klump updates when provided', () => {
    const result = merchantFeatureSettingsPatchSchema.parse({
      klump_enabled: true,
      klump_min_amount: 2_500,
      klump_max_amount: 750_000,
    });

    expect(result).toEqual({
      klump_enabled: true,
      klump_min_amount: 2_500,
      klump_max_amount: 750_000,
    });
  });

  it('toggles the repairs catalogue flag', () => {
    const result = merchantFeatureSettingsPatchSchema.parse({
      repairs_catalog_enabled: true,
    });

    expect(result).toEqual({ repairs_catalog_enabled: true });
  });

  it('preserves the private repair_settings key instead of stripping it', () => {
    const result = merchantFeatureSettingsPatchSchema.parse({
      repair_settings: {
        pickup_address: '3 Olayeni Street, Computer Village',
        city: 'Ikeja',
        state: 'Lagos',
      },
    });

    expect(result).toEqual({
      repair_settings: {
        pickup_address: '3 Olayeni Street, Computer Village',
        city: 'Ikeja',
        state: 'Lagos',
      },
    });
  });

  it('rejects a repair_settings contact email that is invalid', () => {
    const result = merchantFeatureSettingsPatchSchema.safeParse({
      repair_settings: { contact_email: 'not-an-email' },
    });

    expect(result.success).toBe(false);
  });

  it('allows blank and null repair_settings contact emails', () => {
    const blankResult = merchantFeatureSettingsPatchSchema.parse({
      repair_settings: { contact_email: '' },
    });
    const nullResult = merchantFeatureSettingsPatchSchema.parse({
      repair_settings: { contact_email: null },
    });

    expect(blankResult).toEqual({
      repair_settings: { contact_email: null },
    });
    expect(nullResult).toEqual({
      repair_settings: { contact_email: null },
    });
  });

  it('allows empty contact_phone when courier pickup is disabled', () => {
    const result = merchantFeatureSettingsPatchSchema.safeParse({
      repair_settings: {
        pickup_enabled: false,
        contact_phone: '',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repair_settings).toEqual({
        pickup_enabled: false,
        contact_phone: '',
      });
    }
  });

  it('still rejects an invalid contact_phone when pickup is enabled', () => {
    const result = merchantFeatureSettingsPatchSchema.safeParse({
      repair_settings: {
        pickup_enabled: true,
        contact_phone: 'not-a-phone',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid contact_phone even when pickup_enabled is omitted', () => {
    const result = merchantFeatureSettingsPatchSchema.safeParse({
      repair_settings: {
        contact_phone: 'not-a-phone',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects clearing contact_phone in the same patch that enables pickup', () => {
    const result = merchantFeatureSettingsPatchSchema.safeParse({
      repair_settings: {
        pickup_enabled: true,
        contact_phone: '',
      },
    });

    expect(result.success).toBe(false);
  });
});
