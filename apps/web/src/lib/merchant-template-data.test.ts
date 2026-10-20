import { describe, expect, it } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { toTemplateMerchantData } from './merchant-template-data';

const BASE_MERCHANT: CachedMerchant = {
  id: 'merchant-123',
  business_name: 'Ogabassey Electronics',
  site_title: 'Ogabassey',
  site_tagline: 'Best gadgets in Lagos',
  site_description: 'We sell quality electronics.',
  business_type: 'electronics',
  logo_url: 'https://example.com/logo.png',
  phone: '+2348012345678',
  email: 'info@ogabassey.com',
  slug: 'ogabassey',
  business_address: '5 Tech Street, Lagos',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'ogabassey-v2',
  plan_tier: 'pro',
  premium_features: null,
  country: 'NG',
  brand_colors: {
    primary: '#FF6B00',
    secondary: '#1A1A2E',
    accent: '#E94560',
    background: '#FFFFFF',
  },
  social_media: {
    instagram: 'https://instagram.com/ogabassey',
    twitter: 'https://twitter.com/ogabassey',
  },
  support_email: 'support@ogabassey.com',
  support_phone: '+2348099999999',
  custom_domain: 'ogabassey.com',
  favicon_svg_url: 'https://example.com/favicon.svg',
  favicon_png_32_url: 'https://example.com/favicon-32.png',
  favicon_apple_touch_url: 'https://example.com/apple-touch-icon.png',
  paystack_subaccount_code: 'subacct_123',
  legal_entity_name: 'Ogabassey Technologies Ltd',
  registered_address: {
    street: '5 Tech Street',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    postal_code: '100001',
  },
  tax_identification_number: 'TIN-12345',
  trust_profile: {
    return_policy: {
      summary: '7-day returns',
    },
  },
  vat_registration_status: 'registered',
  vat_rate: 7.5,
  feature_settings: {
    blog_enabled: true,
    shipping_insurance_enabled: false,
    google_store_widget_enabled: true,
    wallet_paystack_dva_enabled: true,
    custom_settings: {
      google_merchant_id: '112524323',
      google_store_widget_enabled: false,
      paypal_secret_key: 'server-only-paypal-secret',
      tiktok_access_token: 'server-only-tiktok-token',
    },
    facebook_capi_token: 'server-only-facebook-token',
    ga4_api_secret: 'server-only-ga4-secret',
    paypal_secret_key: 'server-only-nested-secret',
  },
  published_config: {
    google_site_verification: 'google-token',
  },
  pages: {
    about: 'About us content',
    contact: 'Contact page content',
  },
  hero_slides: [
    {
      id: 'slide-1',
      imageUrl: 'https://example.com/hero1.jpg',
      headline: 'New Arrivals',
      description: 'Check out the latest products',
      cta: 'Shop Now',
    },
  ],
  mobile_hero_slides: [
    {
      id: 'slide-m1',
      imageUrl: 'https://example.com/hero-mobile1.jpg',
      headline: 'Mobile Sale',
      description: 'Exclusive mobile deals',
      cta: 'View Deals',
    },
  ],
};

describe('toTemplateMerchantData', () => {
  it('maps all CachedMerchant fields to MerchantData correctly', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);

    expect(result.id).toBe('merchant-123');
    expect(result.business_name).toBe('Ogabassey Electronics');
    expect(result.business_type).toBe('electronics');
    expect(result.email).toBe('info@ogabassey.com');
    expect(result.phone).toBe('+2348012345678');
    expect(result.logo_url).toBe('https://example.com/logo.png');
    expect(result.country).toBe('NG');
    expect(result.payout_currency).toBe('NGN');
    expect(result.slug).toBe('ogabassey');
    expect(result.custom_domain).toBe('ogabassey.com');
    expect(result.favicon_svg_url).toBe('https://example.com/favicon.svg');
    expect(result.favicon_png_32_url).toBe(
      'https://example.com/favicon-32.png'
    );
    expect(result.favicon_apple_touch_url).toBe(
      'https://example.com/apple-touch-icon.png'
    );
    expect(result.is_published).toBe(true);
    expect(result.template_id).toBe('ogabassey-v2');
    expect(result.vat_registration_status).toBe('registered');
    expect(result.vat_rate).toBe(7.5);
    expect(result.social_media).toEqual(BASE_MERCHANT.social_media);
    expect(result.support_email).toBe('support@ogabassey.com');
    expect(result.support_phone).toBe('+2348099999999');
    expect(result.business_address).toBe('5 Tech Street, Lagos');
    expect(result.paystack_subaccount_code).toBe('subacct_123');
    expect(result.legal_entity_name).toBe('Ogabassey Technologies Ltd');
    expect(result.registered_address).toEqual(BASE_MERCHANT.registered_address);
    expect(result.tax_identification_number).toBe('TIN-12345');
    expect(result.trust_profile).toEqual(BASE_MERCHANT.trust_profile);
    expect(result.feature_settings).toEqual({
      blog_enabled: true,
      shipping_insurance_enabled: false,
      google_store_widget_enabled: true,
      wallet_paystack_dva_enabled: true,
      custom_settings: {
        google_merchant_id: '112524323',
        google_store_widget_enabled: false,
      },
    });
    expect(JSON.stringify(result.feature_settings)).not.toContain(
      'server-only'
    );
    expect(result.published_config).toEqual(BASE_MERCHANT.published_config);
    expect(result.plan_tier).toBe('pro');
    expect(result.pages).toEqual(BASE_MERCHANT.pages);
  });

  it('threads snapshot capability hints into template merchant data', () => {
    // Public snapshot merchants replace raw payment/plan fields with derived
    // booleans; template data must carry them for storefront presentation.
    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      paystack_subaccount_configured: true,
      price_negotiation_enabled: true,
    });

    expect(result.paystack_subaccount_configured).toBe(true);
    expect(result.price_negotiation_enabled).toBe(true);
  });

  it('always sets user_id to an empty string to prevent owner id exposure', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);
    expect(result.user_id).toBe('');
  });

  it('preserves hero_slides array', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);
    expect(result.hero_slides).toEqual(BASE_MERCHANT.hero_slides);
    expect(result.hero_slides).toHaveLength(1);
    expect(result.hero_slides?.[0].headline).toBe('New Arrivals');
  });

  it('preserves mobile_hero_slides array', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);
    expect(result.mobile_hero_slides).toEqual(BASE_MERCHANT.mobile_hero_slides);
    expect(result.mobile_hero_slides?.[0].id).toBe('slide-m1');
  });

  it('preserves brand_colors object', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);
    expect(result.brand_colors).toEqual({
      primary: '#FF6B00',
      secondary: '#1A1A2E',
      accent: '#E94560',
      background: '#FFFFFF',
    });
  });

  it('does not serialize secret feature settings into storefront merchant data', () => {
    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      feature_settings: {
        blog_enabled: true,
        custom_settings: {
          google_merchant_id: '112524323',
          paypal_secret_key: 'server-only-paypal-secret',
          paypal_client_id: 'client-id-still-not-needed-in-shell',
          nested_secret: { value: 'server-only-nested-secret' },
        },
        facebook_capi_token: 'server-only-facebook-token',
        ga4_api_secret: 'server-only-ga4-secret',
        tiktok_access_token: 'server-only-tiktok-token',
        webhook_secret: 'server-only-webhook-secret',
      },
    });

    expect(result.feature_settings).toEqual({
      blog_enabled: true,
      custom_settings: {
        google_merchant_id: '112524323',
      },
    });
    expect(JSON.stringify(result)).not.toContain('server-only');
    expect(JSON.stringify(result)).not.toContain('client-id-still-not-needed');
  });

  it('does not create public settings objects for empty or missing allowlisted keys', () => {
    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      feature_settings: {
        custom_settings: {},
        google_merchant_id: undefined,
        google_store_widget_enabled: undefined,
      },
    } as CachedMerchant);

    expect(result.feature_settings).toBeUndefined();
  });

  it('handles a merchant without optional fields', () => {
    const minimal: CachedMerchant = {
      id: 'min-1',
      business_name: 'Minimal Store',
      site_title: '',
      site_tagline: '',
      site_description: '',
      business_type: 'general',
      logo_url: '',
      phone: '',
      email: '',
      slug: 'minimal-store',
      business_address: '',
      payout_currency: 'NGN',
      is_published: false,
      template_id: 'default',
      plan_tier: 'free',
      premium_features: null,
    };

    const result = toTemplateMerchantData(minimal);
    expect(result.user_id).toBe('');
    expect(result.hero_slides).toBeUndefined();
    expect(result.mobile_hero_slides).toBeUndefined();
    expect(result.brand_colors).toBeUndefined();
    expect(result.feature_settings).toBeUndefined();
  });

  it('drops unsupported plan tiers and non-string premium features', () => {
    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      plan_tier: 'legacy-plan',
      premium_features: [1, 2, 3],
    } as unknown as CachedMerchant);

    expect(result.plan_tier).toBeUndefined();
    expect(result.premium_features).toBeUndefined();
  });

  it('forwards about_page when present so the About template renders structured content', () => {
    const aboutPage = {
      headline: 'Making Tech Accessible',
      story: 'We started in a small Lagos shop in 2019.',
      image_url: 'https://example.com/team.jpg',
    };

    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      about_page: aboutPage,
    });

    expect(result.about_page).toEqual(aboutPage);
  });

  it('forwards faq_items when present so the Help/Support template renders merchant FAQs', () => {
    const faqItems = [
      {
        question: 'How do I track my order?',
        answer: 'Use the My Orders page.',
      },
      {
        question: 'What is the return policy?',
        answer: '7-day returns on defective items.',
      },
    ];

    const result = toTemplateMerchantData({
      ...BASE_MERCHANT,
      faq_items: faqItems,
    });

    expect(result.faq_items).toEqual(faqItems);
    expect(result.faq_items).toHaveLength(2);
  });

  it('omits about_page and faq_items when absent (returns undefined, not null)', () => {
    const result = toTemplateMerchantData(BASE_MERCHANT);

    expect(result.about_page).toBeUndefined();
    expect(result.faq_items).toBeUndefined();
  });
});

it('preserves public cart capability hints through the shell merchant projection', () => {
  const merchant = toTemplateMerchantData({
    ...BASE_MERCHANT,
    shared_cart_enabled: true,
    shared_cart_accounts_enabled: false,
    shared_cart_realtime_enabled: true,
  });
  expect(merchant).toMatchObject({
    shared_cart_enabled: true,
    shared_cart_accounts_enabled: false,
    shared_cart_realtime_enabled: true,
  });
});
