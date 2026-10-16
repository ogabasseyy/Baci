import type { CSSProperties, ReactNode } from 'react';
import { HeroMobileControlsSkeleton } from '@/components/storefront/ogabassey/components/hero-mobile-controls-skeleton';
import {
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS,
  HERO_MOBILE_WRAPPER_CLASSES,
} from '@/components/storefront/ogabassey/components/hero-mobile-geometry';

export interface ShellChromeLoadingProps {
  // Optional tenant-provided mobile hero banner. When supplied it is painted in
  // the first static-shell HTML flush (md only), so the real LCP banner shows
  // immediately instead of a placeholder. Kept generic so the shared shell stays
  // decoupled from any one storefront's hero markup.
  mobileHero?: ReactNode;
  showChromeFrame?: boolean;
  showLoadingBar?: boolean;
}

const shellChromeLoadingStyle = {
  background: 'var(--store-background, #ffffff)',
  boxSizing: 'border-box',
  color: 'var(--store-background-text, #111827)',
  padding: '0.75rem 1rem',
  position: 'relative',
  width: '100%',
  zIndex: 1,
} satisfies CSSProperties;

const shellChromeLoadingBarStyle = {
  background:
    'linear-gradient(90deg, color-mix(in srgb, var(--store-primary, #2a2c6e) 10%, transparent) 0%, color-mix(in srgb, var(--store-primary, #2a2c6e) 18%, transparent) 50%, color-mix(in srgb, var(--store-primary, #2a2c6e) 10%, transparent) 100%)',
  backgroundSize: '200% 100%',
  borderRadius: '9999px',
  height: '2.5rem',
  width: '100%',
} satisfies CSSProperties;

const shellChromeFrameStyle = {
  background: 'var(--storefront-shell-background, #0f0f0f)',
  borderBottom:
    '1px solid color-mix(in srgb, var(--store-background, #ffffff) 14%, transparent)',
  boxSizing: 'border-box',
  color: 'var(--store-primary-text, #ffffff)',
  margin: '-0.75rem -1rem 0.75rem',
  padding: '0.75rem 1rem',
} satisfies CSSProperties;

const shellChromeFrameTopStyle = {
  alignItems: 'center',
  display: 'flex',
  gap: '0.75rem',
  minHeight: '3rem',
} satisfies CSSProperties;

const shellChromeFrameLogoStyle = {
  background:
    'linear-gradient(90deg, var(--store-primary, #d62027) 0 28%, var(--store-primary-text, #ffffff) 28% 100%)',
  borderRadius: '9999px',
  height: '1.25rem',
  width: '8rem',
} satisfies CSSProperties;

const shellChromeFrameSearchStyle = {
  background: 'var(--store-background, #ffffff)',
  borderRadius: '9999px',
  flex: '1 1 auto',
  height: '2.25rem',
  maxWidth: '48rem',
  opacity: 0.96,
} satisfies CSSProperties;

const shellChromeFrameActionStyle = {
  background:
    'color-mix(in srgb, var(--store-primary-text, #ffffff) 24%, transparent)',
  borderRadius: '9999px',
  flex: '0 0 auto',
  height: '1.75rem',
  width: '1.75rem',
} satisfies CSSProperties;

const shellChromeFrameNavStyle = {
  display: 'flex',
  gap: '0.75rem',
  marginTop: '0.75rem',
  overflow: 'hidden',
} satisfies CSSProperties;

const shellChromeFrameNavItemStyle = {
  background:
    'color-mix(in srgb, var(--store-primary-text, #ffffff) 18%, transparent)',
  borderRadius: '9999px',
  flex: '0 0 auto',
  height: '1.5rem',
  width: '7rem',
} satisfies CSSProperties;

const homeUtilityReserveOuterStyle = {
  backgroundColor: 'var(--store-background, #ffffff)',
  borderColor:
    'color-mix(in srgb, var(--store-background-text, #111827) 10%, transparent)',
} satisfies CSSProperties;

const homeUtilityReserveCardStyle = {
  backgroundColor: 'var(--store-background, #ffffff)',
  borderColor:
    'color-mix(in srgb, var(--store-background-text, #111827) 10%, transparent)',
} satisfies CSSProperties;

export function LoadingStatus({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} aria-live="polite" className="block">
      {children}
    </div>
  );
}

export function ShellChromeLoading({
  mobileHero,
  showChromeFrame = false,
  showLoadingBar = true,
}: ShellChromeLoadingProps = {}) {
  return (
    <LoadingStatus label="Loading storefront chrome">
      <div
        className="storefront-shell-loading"
        style={shellChromeLoadingStyle}
      >
        {showChromeFrame ? (
          <div
            aria-hidden="true"
            className="storefront-shell-loading__chrome"
            style={shellChromeFrameStyle}
          >
            <div style={shellChromeFrameTopStyle}>
              <div style={shellChromeFrameLogoStyle} />
              <div style={shellChromeFrameSearchStyle} />
              <div style={shellChromeFrameActionStyle} />
              <div style={shellChromeFrameActionStyle} />
            </div>
            <div style={shellChromeFrameNavStyle}>
              <div style={shellChromeFrameNavItemStyle} />
              <div style={shellChromeFrameNavItemStyle} />
              <div style={shellChromeFrameNavItemStyle} />
            </div>
          </div>
        ) : null}
        {mobileHero ? (
          <div
            aria-hidden="true"
            className="storefront-shell-loading__mobile-hero md:hidden"
          >
            {mobileHero}
          </div>
        ) : null}
        {showLoadingBar ? (
          <div
            className="storefront-shell-loading__bar"
            style={shellChromeLoadingBarStyle}
          />
        ) : null}
      </div>
    </LoadingStatus>
  );
}

export function HomeRouteLoading() {
  return (
    <LoadingStatus label="Loading storefront homepage">
      <div aria-hidden="true" data-storefront-home-loading-reserve="true">
        <section className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 pt-4 md:pt-6 flex flex-col">
          <div className={HERO_MOBILE_WRAPPER_CLASSES}>
            <div className={HERO_MOBILE_PANEL_CLASSES} />
            <HeroMobileControlsSkeleton />
          </div>
          <div className="hidden md:grid grid-cols-1 lg:grid-cols-5 gap-4 h-auto lg:h-[540px] order-2">
            <div className="lg:col-span-3 h-[400px] lg:h-full rounded-2xl ring-1 ring-store-border/70 shadow-lg bg-store-secondary" />
            <div className="hidden lg:flex flex-col gap-4 h-full lg:col-span-2">
              <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
              <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
            </div>
          </div>
        </section>
        <div
          className="w-full mt-3 md:mt-8 mb-6 border-y md:py-5"
          style={homeUtilityReserveOuterStyle}
        >
          <div className="md:hidden px-4">
            <div
              className={`${HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS} rounded-3xl shadow-sm border p-2`}
              style={homeUtilityReserveCardStyle}
            />
          </div>
          <div className="hidden md:flex max-w-[1400px] mx-auto px-4 md:px-6 h-[92px]" />
        </div>
        <div className="ogabassey-home-products">
          <div className="min-h-[1200px]" style={{ minHeight: '1200px' }} />
        </div>
      </div>
    </LoadingStatus>
  );
}
