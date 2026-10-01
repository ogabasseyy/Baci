import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ANALYTICS_IDENTIFIER_MAX_LENGTH,
  PLATFORM_GA4_SECRET_MAX_LENGTH,
} from './constants';
import { PlatformSettingsUpdateSchema } from './schema';

describe('PlatformSettingsUpdateSchema', () => {
  it('parses valid update payloads and coerces numeric values', () => {
    const result = PlatformSettingsUpdateSchema.safeParse({
      platform_fee_percentage: '2.5',
      platform_fee_flat: '100',
      support_email: 'support@baci.app',
      enable_custom_domains: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected schema parse to succeed');
    }

    expect(result.data).toEqual({
      platform_fee_percentage: 2.5,
      platform_fee_flat: 100,
      support_email: 'support@baci.app',
      enable_custom_domains: true,
    });
  });

  it.each([
    'id',
    'singleton_key',
    'created_at',
    'updated_at',
  ])('rejects immutable database field %s', (field) => {
    const result = PlatformSettingsUpdateSchema.safeParse({
      [field]: 'immutable',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected schema parse to fail');
    expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects invalid email addresses and negative fee values', () => {
    const result = PlatformSettingsUpdateSchema.safeParse({
      support_email: 'not-an-email',
      platform_fee_flat: -1,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected schema parse to fail');
    }

    expect(result.error.flatten().fieldErrors.support_email).toBeDefined();
    expect(result.error.flatten().fieldErrors.platform_fee_flat).toBeDefined();
  });

  it('rejects null fee values instead of coercing them to zero', () => {
    const result = PlatformSettingsUpdateSchema.safeParse({
      platform_fee_flat: null,
      platform_fee_percentage: null,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected schema parse to fail');
    expect(result.error.flatten().fieldErrors.platform_fee_flat).toBeDefined();
    expect(
      result.error.flatten().fieldErrors.platform_fee_percentage
    ).toBeDefined();
  });

  it('rejects analytics values that exceed their database column limits', () => {
    const result = PlatformSettingsUpdateSchema.safeParse({
      google_analytics_id: 'g'.repeat(
        PLATFORM_ANALYTICS_IDENTIFIER_MAX_LENGTH + 1
      ),
      ga4_api_secret: 's'.repeat(PLATFORM_GA4_SECRET_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected schema parse to fail');
    }

    expect(
      result.error.flatten().fieldErrors.google_analytics_id
    ).toBeDefined();
    expect(result.error.flatten().fieldErrors.ga4_api_secret).toBeDefined();
  });
});
