import { describe, expect, it } from 'vitest';
import { merchantFeatureSettingsSchema } from './merchant-features';

/**
 * Helper function to generate a valid merchant feature settings object.
 * All fields are required by the schema.
 */
function createValidFeatureSettings() {
  return {
    loyalty_enabled: true,
    reviews_enabled: true,
    wishlist_enabled: true,
    order_tracking_enabled: true,
    discount_codes_enabled: true,
    guest_checkout_enabled: true,
    // Payment gateways
    agentic_checkout_enabled: true,
    paystack_enabled: true,
    korapay_enabled: false,
    pay_on_delivery_enabled: true,
    credit_direct_enabled: false,
    credit_direct_public_key: null,
    credit_direct_min_amount: 5000,
    credit_direct_max_amount: 500000,
    klump_enabled: false,
    klump_min_amount: 10000,
    klump_max_amount: 500000,
    preferred_local_gateway: 'paystack' as const,
    preferred_international_gateway: 'paystack' as const,
    // Shipping
    shipping_providers: ['gigl', 'topship'],
    free_shipping_threshold: 10000,
    shipping_markup_percentage: 5,
    // Checkout
    checkout_collect_phone: true,
    checkout_require_account: false,
    checkout_show_order_notes: true,
    // Store pages
    about_page_enabled: true,
    contact_page_enabled: true,
    faq_page_enabled: true,
    privacy_page_enabled: true,
    terms_page_enabled: true,
    rewards_page_enabled: true,
    // Social proof
    show_recent_purchases: true,
    show_stock_levels: true,
    low_stock_threshold: 5,
    // Analytics
    google_analytics_id: null,
    ga4_api_secret: null,
    facebook_pixel_id: null,
    facebook_capi_token: null,
    tiktok_pixel_id: null,
    tiktok_access_token: null,
    snapchat_pixel_id: null,
    snapchat_capi_token: null,
    twitter_pixel_id: null,
    // SEO
    auto_generate_schema: true,
    custom_robots_txt: null,
    // Notifications
    email_notifications_enabled: true,
    sms_notifications_enabled: false,
    // Blog
    blog_enabled: true,
    auto_blog_enabled: false,
    google_reviews_enabled: true,
    google_place_id: null,
    // VTU
    vtu_enabled: true,
    vtu_airtime_enabled: true,
    vtu_data_enabled: true,
    vtu_checkout_addon_enabled: false,
    vtu_checkout_addon_amounts: [100, 200, 500],
    vtu_loyalty_reward_enabled: true,
    vtu_merchant_commission_rate: 2.5,
    vtu_electricity_enabled: true,
    vtu_tv_enabled: true,
    vtu_betting_enabled: false,
    vtu_customer_cashback_enabled: true,
    vtu_customer_cashback_rate: 1.5,
    // Custom
    custom_settings: {},
  };
}

describe('merchantFeatureSettingsSchema', () => {
  describe('valid inputs', () => {
    it('parses complete valid object with all fields', () => {
      // Arrange
      const validSettings = createValidFeatureSettings();

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(validSettings);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validSettings);
      }
    });

    it('accepts agentic_checkout_enabled = true', () => {
      const settings = {
        ...createValidFeatureSettings(),
        agentic_checkout_enabled: true,
      };

      expect(merchantFeatureSettingsSchema.safeParse(settings).success).toBe(
        true
      );
    });

    it('accepts agentic_checkout_enabled = false', () => {
      const settings = {
        ...createValidFeatureSettings(),
        agentic_checkout_enabled: false,
      };

      expect(merchantFeatureSettingsSchema.safeParse(settings).success).toBe(
        true
      );
    });

    it('accepts nullable string fields', () => {
      // Arrange
      const settingsWithNulls = {
        ...createValidFeatureSettings(),
        credit_direct_public_key: null,
        google_analytics_id: null,
        facebook_pixel_id: null,
        custom_robots_txt: null,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(settingsWithNulls);

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts valid string values for nullable fields', () => {
      // Arrange
      const settingsWithStrings = {
        ...createValidFeatureSettings(),
        credit_direct_public_key: 'pk_test_123456',
        google_analytics_id: 'UA-12345678-1',
        facebook_pixel_id: '1234567890123456',
        custom_robots_txt: 'User-agent: *\nDisallow: /admin',
      };

      // Act
      const result =
        merchantFeatureSettingsSchema.safeParse(settingsWithStrings);

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts Klump installment settings and keeps them merchant-scoped', () => {
      const settings = {
        ...createValidFeatureSettings(),
        klump_enabled: true,
        klump_min_amount: 2500,
        klump_max_amount: 750000,
      };

      const result = merchantFeatureSettingsSchema.safeParse(settings);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.klump_enabled).toBe(true);
        expect(result.data.klump_min_amount).toBe(2500);
        expect(result.data.klump_max_amount).toBe(750000);
      }
    });

    it('defaults Klump installment settings when older rows omit the fields', () => {
      const settings = createValidFeatureSettings();
      const {
        klump_enabled,
        klump_min_amount,
        klump_max_amount,
        ...withoutKlumpSettings
      } = settings;

      const result =
        merchantFeatureSettingsSchema.safeParse(withoutKlumpSettings);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.klump_enabled).toBe(false);
        expect(result.data.klump_min_amount).toBe(10_000);
        expect(result.data.klump_max_amount).toBe(1_000_000);
      }
    });

    it('accepts empty arrays for shipping_providers', () => {
      // Arrange
      const settingsWithEmptyArray = {
        ...createValidFeatureSettings(),
        shipping_providers: [],
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(
        settingsWithEmptyArray
      );

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts empty object for custom_settings', () => {
      // Arrange
      const settingsWithEmptyCustom = {
        ...createValidFeatureSettings(),
        custom_settings: {},
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(
        settingsWithEmptyCustom
      );

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts complex custom_settings object', () => {
      // Arrange
      const settingsWithComplexCustom = {
        ...createValidFeatureSettings(),
        custom_settings: {
          theme: 'dark',
          custom_css: '.button { color: red; }',
          features: ['a', 'b', 'c'],
          nested: { value: 123 },
        },
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(
        settingsWithComplexCustom
      );

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('VTU-specific fields', () => {
    it('validates vtu_enabled as boolean', () => {
      // Arrange - valid
      const validVtu = { ...createValidFeatureSettings(), vtu_enabled: true };
      expect(merchantFeatureSettingsSchema.safeParse(validVtu).success).toBe(
        true
      );

      // Arrange - invalid
      const invalidVtu = {
        ...createValidFeatureSettings(),
        vtu_enabled: 'true' as unknown as boolean,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalidVtu).success).toBe(
        false
      );
    });

    it('validates vtu_electricity_enabled as boolean', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_electricity_enabled: false,
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_electricity_enabled: 1 as unknown as boolean,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_tv_enabled as boolean', () => {
      // Arrange - valid
      const valid = { ...createValidFeatureSettings(), vtu_tv_enabled: true };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_tv_enabled: null as unknown as boolean,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_betting_enabled as boolean', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_betting_enabled: false,
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_betting_enabled: 'false' as unknown as boolean,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_customer_cashback_enabled as boolean', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_customer_cashback_enabled: true,
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_customer_cashback_enabled: undefined as unknown as boolean,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_customer_cashback_rate as number', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_customer_cashback_rate: 2.5,
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - valid zero
      const validZero = {
        ...createValidFeatureSettings(),
        vtu_customer_cashback_rate: 0,
      };
      expect(merchantFeatureSettingsSchema.safeParse(validZero).success).toBe(
        true
      );

      // Arrange - invalid string
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_customer_cashback_rate: '2.5' as unknown as number,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_merchant_commission_rate as number', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_merchant_commission_rate: 5.0,
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid boolean
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_merchant_commission_rate: true as unknown as number,
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('validates vtu_checkout_addon_amounts as number array', () => {
      // Arrange - valid
      const valid = {
        ...createValidFeatureSettings(),
        vtu_checkout_addon_amounts: [50, 100, 200, 500, 1000],
      };
      expect(merchantFeatureSettingsSchema.safeParse(valid).success).toBe(true);

      // Arrange - invalid string array
      const invalid = {
        ...createValidFeatureSettings(),
        vtu_checkout_addon_amounts: ['50', '100'] as unknown as number[],
      };
      expect(merchantFeatureSettingsSchema.safeParse(invalid).success).toBe(
        false
      );
    });

    it('includes all VTU-related fields', () => {
      // Arrange
      const settings = createValidFeatureSettings();

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(settings);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('vtu_enabled');
        expect(result.data).toHaveProperty('vtu_airtime_enabled');
        expect(result.data).toHaveProperty('vtu_data_enabled');
        expect(result.data).toHaveProperty('vtu_electricity_enabled');
        expect(result.data).toHaveProperty('vtu_tv_enabled');
        expect(result.data).toHaveProperty('vtu_betting_enabled');
        expect(result.data).toHaveProperty('vtu_customer_cashback_enabled');
        expect(result.data).toHaveProperty('vtu_customer_cashback_rate');
        expect(result.data).toHaveProperty('vtu_merchant_commission_rate');
        expect(result.data).toHaveProperty('vtu_checkout_addon_enabled');
        expect(result.data).toHaveProperty('vtu_checkout_addon_amounts');
        expect(result.data).toHaveProperty('vtu_loyalty_reward_enabled');
      }
    });
  });

  describe('missing required fields', () => {
    it('rejects object missing loyalty_enabled', () => {
      // Arrange
      const settings = createValidFeatureSettings();
      const { loyalty_enabled, ...withoutField } = settings;

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(withoutField);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects object missing vtu_enabled', () => {
      // Arrange
      const settings = createValidFeatureSettings();
      const { vtu_enabled, ...withoutField } = settings;

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(withoutField);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects object missing shipping_providers', () => {
      // Arrange
      const settings = createValidFeatureSettings();
      const { shipping_providers, ...withoutField } = settings;

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(withoutField);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects object missing custom_settings', () => {
      // Arrange
      const settings = createValidFeatureSettings();
      const { custom_settings, ...withoutField } = settings;

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(withoutField);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects empty object', () => {
      // Act
      const result = merchantFeatureSettingsSchema.safeParse({});

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('wrong types', () => {
    it('rejects non-boolean agentic_checkout_enabled', () => {
      const invalidSettings = {
        ...createValidFeatureSettings(),
        agentic_checkout_enabled: 'true' as unknown as boolean,
      };

      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      expect(result.success).toBe(false);
    });

    it('rejects string where boolean expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        loyalty_enabled: 'true' as unknown as boolean,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects boolean where string expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        google_analytics_id: true as unknown as string,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects string where number expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        credit_direct_min_amount: '5000' as unknown as number,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects non-numeric Klump amount bounds', () => {
      const invalidMin = {
        ...createValidFeatureSettings(),
        klump_min_amount: '1000' as unknown as number,
      };
      const invalidMax = {
        ...createValidFeatureSettings(),
        klump_max_amount: '500000' as unknown as number,
      };

      expect(merchantFeatureSettingsSchema.safeParse(invalidMin).success).toBe(
        false
      );
      expect(merchantFeatureSettingsSchema.safeParse(invalidMax).success).toBe(
        false
      );
    });

    it('rejects number where boolean expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        paystack_enabled: 1 as unknown as boolean,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects string where array expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        shipping_providers: 'gigl,topship' as unknown as string[],
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a provider that has no live carrier integration', () => {
      const invalidSettings = {
        ...createValidFeatureSettings(),
        shipping_providers: ['shiip'],
      };

      expect(
        merchantFeatureSettingsSchema.safeParse(invalidSettings).success
      ).toBe(false);
    });

    it('rejects duplicate shipping providers', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        shipping_providers: ['gigl', 'gigl'],
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects array where object expected', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        custom_settings: [] as unknown as Record<string, unknown>,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects invalid enum value for preferred_local_gateway', () => {
      // Arrange
      const invalidSettings = {
        ...createValidFeatureSettings(),
        preferred_local_gateway: 'stripe' as const,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects Klump as preferred_local_gateway because it is an installment option', () => {
      const invalidSettings = {
        ...createValidFeatureSettings(),
        preferred_local_gateway: 'klump' as const,
      };

      const result = merchantFeatureSettingsSchema.safeParse(invalidSettings);

      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts negative numbers for thresholds', () => {
      // Arrange
      const settingsWithNegative = {
        ...createValidFeatureSettings(),
        free_shipping_threshold: -1,
        low_stock_threshold: -5,
      };

      // Act
      const result =
        merchantFeatureSettingsSchema.safeParse(settingsWithNegative);

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts zero for numeric fields', () => {
      // Arrange
      const settingsWithZero = {
        ...createValidFeatureSettings(),
        credit_direct_min_amount: 0,
        credit_direct_max_amount: 0,
        klump_min_amount: 0,
        klump_max_amount: 0,
        shipping_markup_percentage: 0,
        low_stock_threshold: 0,
        vtu_merchant_commission_rate: 0,
        vtu_customer_cashback_rate: 0,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(settingsWithZero);

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts large numbers', () => {
      // Arrange
      const settingsWithLargeNumbers = {
        ...createValidFeatureSettings(),
        credit_direct_max_amount: 999999999,
        klump_max_amount: 999999999,
        free_shipping_threshold: 999999999,
        vtu_merchant_commission_rate: 100,
      };

      // Act
      const result = merchantFeatureSettingsSchema.safeParse(
        settingsWithLargeNumbers
      );

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts decimal numbers for rate fields', () => {
      // Arrange
      const settingsWithDecimals = {
        ...createValidFeatureSettings(),
        shipping_markup_percentage: 12.5,
        vtu_merchant_commission_rate: 3.75,
        vtu_customer_cashback_rate: 0.5,
      };

      // Act
      const result =
        merchantFeatureSettingsSchema.safeParse(settingsWithDecimals);

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
