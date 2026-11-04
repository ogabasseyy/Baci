import { describe, expect, it } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import {
  getOgabasseyBasePath,
  getOgabasseyLayoutStyle,
  shouldEnableOgabasseyGoogleStoreWidget,
  shouldHideOgabasseyNavigation,
} from './storefront-layout-utils';

const baseMerchant: MerchantData = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
};

describe('storefront-layout-utils', () => {
  it('builds the storefront base path from the merchant slug for path-routed stores', () => {
    expect(getOgabasseyBasePath('ogabassey', 'path')).toBe('/ogabassey');
    expect(getOgabasseyBasePath(undefined, 'path')).toBe('/ogabassey');
  });

  it('returns an empty base path for domain-routed stores', () => {
    expect(getOgabasseyBasePath('ogabassey', 'domain')).toBe('');
  });

  it('enables the Google store widget for the Ogabassey storefront fallback case', () => {
    expect(shouldEnableOgabasseyGoogleStoreWidget(baseMerchant)).toBe(true);
  });

  it('respects explicit merchant widget preferences over the fallback domain check', () => {
    expect(
      shouldEnableOgabasseyGoogleStoreWidget({
        ...baseMerchant,
        feature_settings: {
          google_store_widget_enabled: false,
        },
      })
    ).toBe(false);
  });

  it('hides navigation for checkout and auth-like routes', () => {
    expect(shouldHideOgabasseyNavigation('/ogabassey/checkout')).toBe(true);
    expect(shouldHideOgabasseyNavigation('/ogabassey/account/login')).toBe(
      true
    );
    expect(shouldHideOgabasseyNavigation('/ogabassey/auth/reset')).toBe(true);
    expect(shouldHideOgabasseyNavigation('/ogabassey/products')).toBe(false);
    expect(shouldHideOgabasseyNavigation('/ogabassey/products', true)).toBe(
      true
    );
  });

  it('builds the storefront style variables from merchant brand colors', () => {
    const style = getOgabasseyLayoutStyle({
      ...baseMerchant,
      brand_colors: {
        primary: '#111111',
        accent: '#eeeeee',
        background: '#ffffff',
      },
    }) as Record<string, string>;

    expect(style['--store-primary']).toBe('#111111');
    expect(style['--store-on-primary']).toBe('#FFFFFF');
    expect(style['--store-border']).toBe('rgba(17, 17, 17, 0.24)');
    expect(style['--store-accent']).toBe('#eeeeee');
    expect(style['--background']).toBe('0 0% 100%');
    expect(style['--foreground']).toBe('0 0% 0%');
  });

  it('falls back to the default storefront palette when merchant colors are absent', () => {
    const style = getOgabasseyLayoutStyle(undefined) as Record<string, string>;

    expect(style['--store-primary']).toBe('#d62027');
    expect(style['--store-on-primary']).toBe('#FFFFFF');
    expect(style['--store-border']).toBe('rgba(214, 32, 39, 0.24)');
    expect(style['--store-accent']).toBe('#d62027');
    expect(style['--background']).toBe('0 0% 6%');
    expect(style['--foreground']).toBe('0 0% 98%');
  });
});
