'use client';

import {
  ChevronDown,
  LayoutGrid,
  Newspaper,
  ScanBarcode,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { GadgetPattern } from '../components/GadgetPattern';

const NavbarCategoryDropdown = lazy(async () => {
  const module = await import('./navbar-category-dropdown');
  return { default: module.NavbarCategoryDropdown };
});

interface NavigationCategory {
  name: string;
  slug: string;
}

interface NavbarSecondaryNavProps {
  basePath: string;
  categories: NavigationCategory[];
}

export function NavbarSecondaryNav({
  basePath,
  categories,
}: NavbarSecondaryNavProps) {
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryRef = useRef<HTMLDivElement>(null);
  const dropdownId = 'ogabassey-navbar-secondary__dropdown';

  useEffect(() => {
    if (!showCategoryDropdown) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!categoryRef.current?.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCategoryDropdown]);

  return (
    <div className="ogabassey-navbar-secondary">
      {/*
        Denser BLACK-stroke variant of GadgetPattern's tile — rendered as an
        inline <svg><pattern> (not a `background-image: url(data:svg)` div)
        because url() backgrounds ARE LCP candidates; this is the same fix
        #3044 applied to GadgetPattern's default variant. opacity=0.03
        preserves the previous `.ogabassey-navbar-secondary__pattern` CSS
        opacity now that the inline <svg> style takes precedence over that
        class.
      */}
      <GadgetPattern
        className="ogabassey-navbar-secondary__pattern"
        opacity={0.03}
        stroke="#000000"
      />

      <div className="ogabassey-navbar-secondary__inner">
        <div className="ogabassey-navbar-secondary__list">
          <div className="ogabassey-navbar-secondary__category" ref={categoryRef}>
            <button
              type="button"
              onClick={() => setShowCategoryDropdown((current) => !current)}
              className="ogabassey-navbar-secondary__button"
              data-open={showCategoryDropdown ? 'true' : undefined}
              aria-controls={dropdownId}
              aria-expanded={showCategoryDropdown}
            >
              <LayoutGrid size={18} aria-hidden="true" />
              Shop by Category
              <ChevronDown
                size={14}
                className="ogabassey-navbar-secondary__chevron"
                aria-hidden="true"
                data-open={showCategoryDropdown ? 'true' : undefined}
              />
            </button>

            {showCategoryDropdown ? (
              <Suspense fallback={null}>
                <NavbarCategoryDropdown
                  basePath={basePath}
                  categories={categories}
                  dropdownId={dropdownId}
                  onClose={() => setShowCategoryDropdown(false)}
                />
              </Suspense>
            ) : null}
          </div>

          <div className="ogabassey-navbar-secondary__divider" />

          <Link
            href={`${basePath}/imei-check` as `/${string}`}
            prefetch={false}
            className="ogabassey-navbar-secondary__link"
          >
            <ScanBarcode size={18} aria-hidden="true" />
            IMEI Checker
          </Link>

          <div className="ogabassey-navbar-secondary__divider" />

          <Link
            href={`${basePath}/repairs` as `/${string}`}
            prefetch={false}
            className="ogabassey-navbar-secondary__link"
          >
            <Wrench size={18} aria-hidden="true" />
            Repairs
          </Link>

          <div className="ogabassey-navbar-secondary__divider" />

          <Link
            href={`${basePath}/wallet` as `/${string}`}
            prefetch={false}
            className="ogabassey-navbar-secondary__link"
          >
            <Wallet size={18} aria-hidden="true" />
            Wallet
          </Link>

          <div className="ogabassey-navbar-secondary__divider" />

          <Link
            href={`${basePath}/blog` as `/${string}`}
            prefetch={false}
            className="ogabassey-navbar-secondary__link"
          >
            <Newspaper size={18} aria-hidden="true" />
            Blog
          </Link>
        </div>
      </div>
    </div>
  );
}
