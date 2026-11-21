'use client';

import {
  Menu,
  ShoppingCart,
  User,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useRef, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { Logo } from './logo';
import { GadgetPattern } from '../components/GadgetPattern';
import { useOgabasseyScrollVisibility } from '../scroll-visibility-store';
import { NavbarNotifications } from './navbar-notifications';
import { NavbarSearch } from './navbar-search';
import { NavbarSecondaryNav } from './navbar-secondary-nav';

interface NavbarProps {
  storeSlug?: string;
}

const DeferredMobileMenu = dynamic(
  () => import('./mobile-menu').then((mod) => mod.MobileMenu),
  { ssr: false }
);

function NavbarSearchPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="ogabassey-navbar-search ogabassey-navbar-search--placeholder"
    >
      <div className="ogabassey-navbar-search__input" />
    </div>
  );
}

export const OgabasseyNavbar: React.FC<NavbarProps> = ({
  storeSlug,
}) => {
  const { totalItems, isHydrated, setIsCartOpen } = useCart();
  const merchantContext = useMerchantSafe();
  const merchantId = merchantContext?.merchant?.id;
  const pathname = usePathname();
  const isBlogPage = pathname?.includes('/blog');
  const basePath = storeSlug
    ? storeSlug.startsWith('/')
      ? encodeURI(storeSlug)
      : `/${encodeURIComponent(storeSlug)}`
    : '';
  const categories =
    merchantContext?.navigationCategories?.map((category) => ({
      name: category.name,
      slug: category.slug,
    })) ?? [];
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isVisible = useOgabasseyScrollVisibility();
  const visibleCartItems = isHydrated ? totalItems : 0;

  return (
    <>
      <header
        className="ogabassey-navbar"
        data-visible={isVisible ? 'true' : undefined}
      >
        {/* --- TOP HEADER ROW (BLACK) --- */}
        <div className="ogabassey-navbar__top">
          {/* Dark Pattern Background Container - Optimized CSS-only implementation */}
          {/* Dark Pattern Background Container - Restored Gadget Pattern */}
          <GadgetPattern opacity={0.1} />

          <div className="ogabassey-navbar__inner">
            <div className="ogabassey-navbar__primary-row">
              {/* Header Row: Menu, Logo, Icons (Mobile: Spaced out | Desktop: Grouped Left) */}
              <div className="ogabassey-navbar__brand-row">
                {/* Left: Menu & Logo */}
                <div className="ogabassey-navbar__brand-group">
                  <button
                    type="button"
                    ref={menuButtonRef}
                    aria-label="Open menu"
                    aria-expanded={isMenuOpen}
                    aria-controls="mobile-menu"
                    onClick={() => setIsMenuOpen(true)}
                    className="ogabassey-navbar__menu-button"
                  >
                    <Menu aria-hidden="true" />
                  </button>

                  <Link
                    href={(basePath || '/') as `/${string}`}
                    prefetch={false}
                    className="ogabassey-navbar__logo-link"
                  >
                    <Logo className="ogabassey-navbar__logo" />
                  </Link>
                </div>
              </div>

              {/* Search Bar - Full Width Mobile, Center Desktop */}
              <div className="ogabassey-navbar__search-wrap">
                {merchantId ? (
                  <NavbarSearch
                    basePath={basePath}
                    isBlogPage={Boolean(isBlogPage)}
                    merchantId={merchantId}
                  />
                ) : (
                  <NavbarSearchPlaceholder />
                )}
              </div>

              {/* Desktop Right Icons */}
              <div className="ogabassey-navbar__desktop-actions">
                <NavbarNotifications basePath={basePath} />

                <Link
                  href={`${basePath}/cart` as `/${string}`}
                  prefetch={false}
                  onClick={(e) => {
                    if (
                      e.button !== 0 ||
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey ||
                      (typeof window !== 'undefined' &&
                        typeof window.matchMedia === 'function' &&
                        window.matchMedia('(max-width: 767px)').matches)
                    ) {
                      return;
                    }
                    e.preventDefault();
                    setIsCartOpen(true);
                  }}
                  className="ogabassey-navbar__icon-link"
                >
                  <ShoppingCart size={22} aria-hidden="true" />
                  <span className="sr-only">
                    {visibleCartItems > 0
                      ? `Open cart (${visibleCartItems} ${visibleCartItems === 1 ? 'item' : 'items'})`
                      : 'Open cart'}
                  </span>
                  <span
                    aria-hidden="true"
                    className="ogabassey-navbar__cart-badge"
                    data-visible={visibleCartItems > 0 ? 'true' : undefined}
                  >
                    {visibleCartItems}
                  </span>
                </Link>
                <Link
                  href={`${basePath}/account` as `/${string}`}
                  prefetch={false}
                  className="ogabassey-navbar__icon-link"
                >
                  <User size={22} aria-hidden="true" />
                  <span className="sr-only">View account</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <NavbarSecondaryNav basePath={basePath} categories={categories} />
      </header>

      {isMenuOpen ? (
        <DeferredMobileMenu
          isOpen={isMenuOpen}
          onClose={(reason = 'dismiss') => {
            setIsMenuOpen(false);
            if (reason === 'dismiss') {
              menuButtonRef.current?.focus();
            }
          }}
          storeSlug={basePath}
        />
      ) : null}
    </>
  );
};
