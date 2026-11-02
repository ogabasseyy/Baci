import type { CSSProperties } from 'react';
import {
  normalizeHostname,
  resolveGoogleStoreWidgetPreference,
} from '@/components/analytics/google-store-widget-utils';
import type { MerchantData } from '@/hooks/merchant/types';
import {
  getContrastingTextColor,
  hexToHslComponents,
  hexToRgba,
} from '@/lib/color-utils';

const DEFAULT_PRIMARY_COLOR = '#d62027';
const DEFAULT_BACKGROUND_HSL = '0 0% 6%';
const DEFAULT_FOREGROUND_HSL = '0 0% 98%';
const STORE_BORDER_ALPHA = 0.24;

export type OgabasseyChromeSection = 'header' | 'footer' | 'overlay';

export function getOgabasseyBasePath(
  slug?: string | null,
  routingMode: 'domain' | 'path' = 'path'
) {
  return routingMode === 'domain' ? '' : `/${slug || 'ogabassey'}`;
}

export function shouldEnableOgabasseyGoogleStoreWidget(
  merchant?: MerchantData
) {
  const merchantControlledPreference =
    resolveGoogleStoreWidgetPreference(merchant);

  if (typeof merchantControlledPreference === 'boolean') {
    return merchantControlledPreference;
  }

  const normalizedCustomDomain = normalizeHostname(merchant?.custom_domain);

  return (
    merchant?.slug === 'ogabassey' || normalizedCustomDomain === 'ogabassey.com'
  );
}

export function shouldHideOgabasseyNavigation(
  pathname?: string | null,
  initialHideNavigation = false
) {
  if (initialHideNavigation) {
    return true;
  }

  if (!pathname) {
    return false;
  }

  return (
    pathname.includes('/checkout') ||
    pathname.includes('/account/login') ||
    pathname.includes('/track-order') ||
    pathname.includes('/auth/')
  );
}

export function getOgabasseyLayoutStyle(
  merchant?: MerchantData
): CSSProperties {
  const backgroundColor = merchant?.brand_colors?.background;
  const primaryColor = merchant?.brand_colors?.primary || DEFAULT_PRIMARY_COLOR;
  const primaryTextColor = getContrastingTextColor(primaryColor);
  const accentColor = merchant?.brand_colors?.accent || DEFAULT_PRIMARY_COLOR;

  return {
    '--background': backgroundColor
      ? hexToHslComponents(backgroundColor)
      : DEFAULT_BACKGROUND_HSL,
    '--foreground': backgroundColor
      ? hexToHslComponents(getContrastingTextColor(backgroundColor))
      : DEFAULT_FOREGROUND_HSL,
    '--card': backgroundColor
      ? hexToHslComponents(backgroundColor)
      : DEFAULT_BACKGROUND_HSL,
    '--card-foreground': backgroundColor
      ? hexToHslComponents(getContrastingTextColor(backgroundColor))
      : DEFAULT_FOREGROUND_HSL,
    '--primary': hexToHslComponents(primaryColor),
    '--primary-foreground': hexToHslComponents(primaryTextColor),
    '--accent': hexToHslComponents(accentColor),
    '--accent-foreground': hexToHslComponents(
      getContrastingTextColor(accentColor)
    ),
    '--ring': hexToHslComponents(primaryColor),
    '--store-primary': primaryColor,
    '--store-primary-text': primaryTextColor,
    '--store-on-primary': primaryTextColor,
    '--store-border': hexToRgba(primaryColor, STORE_BORDER_ALPHA),
    '--store-accent': accentColor,
  } as CSSProperties;
}
