'use client';

import dynamic from 'next/dynamic';
import {
  getContrastingTextColor,
  hexToHslComponents,
  hexToRgba,
} from '@/lib/color-utils';
import { cn } from '@/lib/utils';

export interface AppBodyMerchant {
  brand_colors?: {
    primary?: string;
    background?: string;
    accent?: string;
  };
}

const STORE_BORDER_ALPHA = 0.24;

// Dynamically import non-critical components to reduce initial bundle size
// These components appear after user interaction or with delay
const CookieConsent = dynamic(
  () =>
    import('@/components/storefront/cookie-consent').then(
      (mod) => mod.CookieConsent
    ),
  { ssr: false }
);

const NewsletterWidget = dynamic(
  () =>
    import('@/components/storefront/newsletter-widget').then(
      (mod) => mod.NewsletterWidget
    ),
  { ssr: false }
);

// Platform analytics - dynamically imported for non-blocking initial render
const PlatformAnalyticsProvider = dynamic(
  () =>
    import('@/components/analytics/platform-analytics-provider').then(
      (mod) => mod.PlatformAnalyticsProvider
    ),
  { ssr: false }
);

export default function AppBody({
  children,
  merchant,
  showNewsletterWidget = true,
  showCookieConsent = true,
  showPlatformAnalytics = false,
  applyMerchantCoreThemeVariables = true,
}: {
  children: React.ReactNode;
  merchant?: AppBodyMerchant | null;
  showNewsletterWidget?: boolean;
  showCookieConsent?: boolean;
  showPlatformAnalytics?: boolean;
  /**
   * Storefront pages can opt in to overriding core shadcn variables
   * to prevent background flashes before merchant branding hydrates.
   * Dashboard should keep this disabled so dark mode can control core tokens.
   */
  applyMerchantCoreThemeVariables?: boolean;
}) {
  const brandColors = merchant?.brand_colors
    ? {
        primary: merchant.brand_colors.primary ?? '',
        background: merchant.brand_colors.background ?? '',
        accent: merchant.brand_colors.accent ?? '',
      }
    : undefined;
  const primaryTextColor = brandColors
    ? getContrastingTextColor(brandColors.primary)
    : undefined;
  // Define CSS variables for the merchant's theme
  const themeStyle = brandColors
    ? {
        ...(applyMerchantCoreThemeVariables
          ? {
              // Storefront-only: lock core tokens to merchant background
              // to prevent an initial dashboard-theme flash during hydration.
              '--background': hexToHslComponents(brandColors.background),
              '--foreground': hexToHslComponents(
                getContrastingTextColor(brandColors.background)
              ),
              '--card': hexToHslComponents(brandColors.background),
              '--card-foreground': hexToHslComponents(
                getContrastingTextColor(brandColors.background)
              ),
            }
          : {}),
        '--primary': hexToHslComponents(brandColors.primary),
        '--primary-foreground': hexToHslComponents(
          getContrastingTextColor(brandColors.primary)
        ),
        '--accent': hexToHslComponents(brandColors.accent),
        '--accent-foreground': hexToHslComponents(
          getContrastingTextColor(brandColors.accent)
        ),
        '--ring': hexToHslComponents(brandColors.primary),

        // Legacy/Custom Baci variables
        '--store-primary': brandColors.primary,
        '--store-background': brandColors.background,
        '--store-accent': brandColors.accent,
        '--store-primary-text': primaryTextColor,
        '--store-on-primary': primaryTextColor,
        '--store-border': hexToRgba(brandColors.primary, STORE_BORDER_ALPHA),
        '--store-background-text': getContrastingTextColor(
          brandColors.background
        ),
        '--store-accent-text': getContrastingTextColor(brandColors.accent),
      }
    : {};

  return (
    <div
      className={cn(
        'min-h-screen font-sans antialiased transition-opacity duration-300 opacity-100 relative overflow-x-hidden',
        // Dynamic background with subtle grid and gradient mesh
        'bg-background selection:bg-primary/20'
      )}
      style={{
        ...(themeStyle as React.CSSProperties),
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Dynamic Background Elements - GPU accelerated with will-change */}
      <div className="fixed inset-0 -z-10 h-full w-full bg-background">
        <div className="absolute h-full w-full bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-size-[14px_24px]" />
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto size-[310px] rounded-full bg-primary/20 opacity-20 blur-[100px] will-change-transform" />
        <div className="absolute right-0 bottom-0 -z-10 size-[310px] rounded-full bg-accent/20 opacity-20 blur-[100px] will-change-transform" />
      </div>

      {showPlatformAnalytics && <PlatformAnalyticsProvider />}

      <div className="relative z-0">{children}</div>

      {showNewsletterWidget && (
        <NewsletterWidget position="bottom-left" showDelay={5000} />
      )}
      {showCookieConsent && <CookieConsent />}
    </div>
  );
}
