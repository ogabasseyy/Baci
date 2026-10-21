'use client';

import { Heart, Home, ShoppingCart, User, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';

import { useCart } from '@/hooks/cart';
import { asRoute } from '@/lib/routes';
import { useOgabasseyScrollVisibility } from '../scroll-visibility-store';
import { GadgetPattern } from './GadgetPattern';

interface MobileFooterProps {
  storeSlug?: string;
}

/**
 * Mobile Footer Navigation - 2025 Best Practices Implementation
 *
 * Key features:
 * - 5 items max (UX standard for mobile nav)
 * - Smart scroll hide with debouncing (not too aggressive)
 * - Safe area padding for iOS/browser toolbar zones
 * - Outline → filled icon state transitions
 * - Haptic-style visual feedback on tap
 * - No overflow-hidden (prevents badge clipping)
 * - Higher z-index (z-50) for proper layering
 */
export const MobileFooter: React.FC<MobileFooterProps> = ({ storeSlug = '' }) => {
  const { totalItems, isHydrated } = useCart();
  const pathname = usePathname();
  const isVisible = useOgabasseyScrollVisibility();
  const visibleCartItems = isHydrated ? totalItems : 0;

  // Build store-relative path - handle both with and without leading slash
  const normalizedSlug = storeSlug.startsWith('/')
    ? storeSlug
    : storeSlug
      ? `/${storeSlug}`
      : '';
  const basePath = normalizedSlug;

  // Active state logic
  const isActive = (path: string) => {
    const fullPath = `${basePath}${path}`;
    if (path === '/account') {
      return pathname?.startsWith(`${basePath}/account`) || false;
    }
    if (path === '/') {
      return pathname === basePath || pathname === `${basePath}/`;
    }
    return pathname === fullPath || pathname?.startsWith(`${fullPath}/`) || false;
  };

  // Navigation items configuration
  const navItems = [
    { path: '/', icon: Home, label: 'Home' },
    { path: '/wishlist', icon: Heart, label: 'Saved' },
    {
      path: '/cart',
      icon: ShoppingCart,
      label: 'Cart',
      badge: visibleCartItems,
    },
    { path: '/wallet', icon: Wallet, label: 'Wallet' },
    { path: '/account', icon: User, label: 'Account' },
  ];
  const footerClasses = [
    'ogabassey-mobile-footer',
    !isVisible && 'ogabassey-mobile-footer--hidden',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav aria-label="Mobile navigation" className={footerClasses}>
      {/* Subtle top highlight */}
      <div className="ogabassey-mobile-footer__highlight" />

      {/*
        Background Pattern - Matching Header Style with specific opacity.
        "ULTRA SPARSE" white-stroke variant of GadgetPattern's tile — rendered
        as an inline <svg><pattern> (not a `background-image: url(data:svg)`
        div) because url() backgrounds ARE LCP candidates and this exact
        pattern was field-caught winning homepage LCP at 4648ms post-#3044
        (PostHog, 2026-07-11). opacity=0.07 preserves the previous
        `.ogabassey-mobile-footer__pattern` CSS opacity now that the inline
        <svg> style takes precedence over that class.
      */}
      <GadgetPattern
        className="ogabassey-mobile-footer__pattern"
        opacity={0.07}
        stroke="#ffffff"
      />

      <div className="ogabassey-mobile-footer__items">
        {navItems.map(({ path, icon: Icon, label, badge }) => {
          const active = isActive(path);
          const badgeText = badge !== undefined && badge > 99 ? '99+' : badge;
          const badgeLabel =
            badge !== undefined && badge > 0
              ? `${label} (${badgeText} ${badge === 1 ? 'item' : 'items'})`
              : label;

          return (
            <Link
              key={path}
              href={asRoute(`${basePath}${path}`)}
              prefetch={false}
              className="ogabassey-mobile-footer__item"
              aria-label={badgeLabel}
              aria-current={active ? 'page' : undefined}
              data-active={active ? 'true' : undefined}
            >
              {/* Icon container */}
              <div className="ogabassey-mobile-footer__icon">
                <Icon
                  size={24}
                  strokeWidth={active ? 2.5 : 1.75}
                  fill={active ? 'currentColor' : 'none'}
                />

                {/* Badge for cart count */}
                {badge !== undefined && badge > 0 && (
                  <span
                    className="ogabassey-mobile-footer__badge"
                    aria-hidden="true"
                  >
                    {badgeText}
                  </span>
                )}
              </div>

              {/* Label - only shown for active item */}
              <span className="ogabassey-mobile-footer__label">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export { MobileFooter as OgabasseyMobileFooter };
