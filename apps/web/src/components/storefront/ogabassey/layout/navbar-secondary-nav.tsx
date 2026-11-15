'use client';

import {
  ArrowLeftRight,
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
      >
        <g transform="translate(20, 20) rotate(-15 6 10)">
          <rect height="20" rx="2" width="12" x="0" y="0" />
          <line strokeWidth="1" x1="4" x2="8" y1="17" y2="17" />
        </g>
        <g transform="translate(90, 15) rotate(10 10 7)">
          <path d="M2 0 h16 v10 h-16 z M0 10 h20 v2 h-20 z" />
        </g>
        <g transform="translate(25, 80) rotate(20 8 8)">
          <path d="M0 10 v5 h4 v-5 a6 6 0 1 1 12 0 v5 h4 v-5" />
        </g>
        <g transform="translate(75, 100) rotate(-10 6 6)">
          <rect height="12" rx="3" width="12" x="0" y="0" />
          <path d="M3 -3 v3 M9 -3 v3 M3 12 v3 M9 12 v3" />
        </g>
        <g transform="translate(120, 90) rotate(5 9 6)">
          <rect height="12" rx="2" width="18" x="0" y="3" />
          <circle cx="9" cy="9" r="3" />
          <rect height="3" rx="1" width="4" x="2" y="0" />
        </g>
        <g transform="translate(70, 50) rotate(-25 10 6)">
          <rect height="12" rx="6" width="20" x="0" y="0" />
          <circle cx="6" cy="6" r="2" />
          <circle cx="14" cy="6" r="2" />
        </g>
        <g transform="translate(120, 40) rotate(35 8 10)">
          <rect height="20" rx="2" width="16" x="0" y="0" />
        </g>
        <g transform="translate(50, 15) rotate(45 5 5)">
          <rect height="14" rx="1" width="6" x="2" y="-2" />
          <rect height="6" rx="2" width="10" x="0" y="2" />
        </g>
        <g transform="translate(10, 55) rotate(15 5 8)">
          <rect height="16" rx="5" width="10" x="0" y="0" />
          <line x1="5" x2="5" y1="0" y2="6" />
        </g>
        <g transform="translate(45, 115) rotate(-10 6 8)">
          <rect height="16" rx="1" width="12" x="0" y="0" />
          <circle cx="6" cy="4" r="2" />
          <circle cx="6" cy="11" r="3" />
        </g>
        <g transform="translate(100, 75) rotate(30 6 6)">
          <rect height="8" rx="2" width="12" x="0" y="4" />
          <path d="M2 4 v-4 M10 4 v-4" />
        </g>
        <g transform="translate(135, 125) rotate(-45 5 9)">
          <rect height="18" rx="2" width="10" x="0" y="0" />
        </g>
        <g transform="translate(10, 120) rotate(0)">
          <path d="M0 5 q5 -10 10 0 t10 0" strokeLinecap="round" />
        </g>
        <circle cx="60" cy="60" fill="#000000" r="1.5" />
        <path d="M90 130 l4 4 m-4 0 l4 -4" strokeWidth="1" />
        <circle cx="140" cy="20" fill="#000000" r="2" stroke="none" />
        <path d="M30 5 l3 3 m-3 0 l3 -3" strokeWidth="1" />
        <circle cx="80" cy="30" r="1" />
        <circle cx="110" cy="110" r="1.5" />
      </GadgetPattern>

      <div className="ogabassey-navbar-secondary__inner">
        <div className="ogabassey-navbar-secondary__list">
          <div
            className="ogabassey-navbar-secondary__category"
            ref={categoryRef}
          >
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

          <Link
            href={`${basePath}/swap` as `/${string}`}
            prefetch={false}
            className="ogabassey-navbar-secondary__link"
          >
            <ArrowLeftRight size={18} aria-hidden="true" />
            Swap / Trade-in
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
