'use client';

import { ArrowUpRight, ChevronRight, Leaf, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { normalizeStorefrontCategorySlug } from '@/lib/normalize-storefront-category-slug';
import { asRoute } from '@/lib/routes';
import { Logo } from './logo';
import {
  MOBILE_MENU_ACCOUNT_ITEMS,
  MOBILE_MENU_SHOP_ITEMS,
  MOBILE_MENU_SUPPORT_ITEMS,
  type MobileMenuItem,
} from './mobile-menu-constants';
import { resolveActiveMobileMenuPath } from './resolve-active-mobile-menu-path';
import { resolveMobileMenuBasePath } from './resolve-mobile-menu-base-path';
import { useMobileMenuDialog } from './use-mobile-menu-dialog';

function getCanonicalNavigationCategories(
  categories?: readonly { name: string; slug: string }[]
): Array<{ name: string; slug: string }> {
  if (!categories || categories.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: Array<{ name: string; slug: string }> = [];
  for (const category of categories) {
    const normalizedSlug = normalizeStorefrontCategorySlug(category.slug);
    if (normalizedSlug && !seen.has(normalizedSlug)) {
      seen.add(normalizedSlug);
      result.push({
        name: category.name,
        slug: normalizedSlug,
      });
    }
  }
  return result;
}

const SECTION_HEADING =
  'mb-2 px-2 font-bold text-[11px] text-store-background-text/75 uppercase tracking-[0.14em]';
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-background-text';

export interface MobileMenuProps {
  isOpen: boolean;
  onClose: (reason?: 'dismiss' | 'navigate') => void;
  storeSlug?: string;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  storeSlug,
}) => {
  const pathname = usePathname();
  const merchantContext = useMerchantSafe();
  const { dialogRef, closeButtonRef } = useMobileMenuDialog({
    isOpen,
    onClose,
  });

  if (!isOpen) {
    return null;
  }

  const basePath = resolveMobileMenuBasePath(
    storeSlug,
    merchantContext?.basePath,
    pathname
  );
  const businessName = merchantContext?.merchant?.business_name || 'Ogabassey';
  const normalizedCategories = getCanonicalNavigationCategories(
    merchantContext?.navigationCategories
  );

  const buildHref = (path: string) => {
    if (path === '/') {
      return basePath || '/';
    }
    return `${basePath}${path}`;
  };

  const allItems = [
    ...MOBILE_MENU_SHOP_ITEMS,
    ...MOBILE_MENU_ACCOUNT_ITEMS,
    ...MOBILE_MENU_SUPPORT_ITEMS,
  ];

  const activePath = resolveActiveMobileMenuPath({
    items: allItems,
    pathname,
    buildHref,
  });

  const renderSection = (title: string, items: MobileMenuItem[]) => (
    <div className="mb-6 px-4 last:mb-0">
      <h2 className={SECTION_HEADING}>
        {title}
      </h2>
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive = item.path === activePath;
          return (
            <li key={item.path}>
              <Link
                href={asRoute(buildHref(item.path))}
                prefetch={false}
                onClick={() => onClose('navigate')}
                aria-current={isActive ? 'page' : undefined}
                className={`group flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-2 py-1 text-sm motion-safe:transition-colors ${FOCUS_RING} ${
                  isActive
                    ? 'border-store-primary/30 bg-store-primary/10 font-bold'
                    : 'border-transparent font-medium hover:bg-store-background-text/5'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                      isActive
                        ? 'bg-store-primary text-store-primary-text'
                        : 'bg-store-background-text/5'
                    }`}
                  >
                    <item.icon size={17} aria-hidden="true" />
                  </span>
                  {item.label}
                </span>
                {item.path === '/swap' || item.path === '/repairs' ? (
                  <Leaf
                    className="shrink-0 text-[color:color-mix(in_srgb,#27804b_60%,var(--store-background-text))]"
                    size={16}
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="shrink-0 text-store-background-text/60"
                    size={15}
                    aria-hidden="true"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div
      id="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile menu"
      data-open="true"
      className="fixed inset-0 z-100"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div
        role="presentation"
        className="absolute inset-0 bg-black/60 motion-safe:fade-in motion-safe:animate-in motion-safe:duration-200"
        onClick={() => onClose('dismiss')}
      />

      {/* Sidebar */}
      <div className="absolute inset-y-0 left-0 flex w-[calc(100%-2rem)] max-w-[360px] flex-col border-store-border border-r bg-[color:color-mix(in_srgb,var(--store-background)_97%,#c78257)] text-store-background-text shadow-2xl motion-safe:slide-in-from-left motion-safe:animate-in motion-safe:duration-300">
        <div className="flex shrink-0 items-center justify-between border-store-border border-b bg-[color:color-mix(in_srgb,var(--store-background)_90%,#f5ac79)] px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Logo
            className="h-6 w-auto text-store-background-text"
            color="current"
          />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={() => onClose('dismiss')}
            className={`grid size-11 shrink-0 place-items-center rounded-full border border-store-background-text/20 bg-store-background hover:bg-store-background-text/10 motion-safe:transition-colors ${FOCUS_RING}`}
            aria-label="Close menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav
          aria-label="Mobile storefront navigation"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-5"
        >
          {renderSection('Shop & Services', MOBILE_MENU_SHOP_ITEMS)}

          {normalizedCategories.length > 0 && (
            <div className="mb-6 px-4">
              <h2 className={SECTION_HEADING}>
                Categories
              </h2>
              <ul className="flex flex-wrap gap-1.5 px-1">
                {normalizedCategories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={asRoute(
                        buildHref(`/${encodeURIComponent(category.slug)}`)
                      )}
                      prefetch={false}
                      onClick={() => onClose('navigate')}
                      className={`inline-flex min-h-9 items-center rounded-full border border-store-background-text/20 bg-store-background px-3 font-semibold text-xs hover:border-store-primary/50 hover:bg-store-primary/10 motion-safe:transition-colors ${FOCUS_RING}`}
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {renderSection('Account & Wallet', MOBILE_MENU_ACCOUNT_ITEMS)}
          {renderSection('Support', MOBILE_MENU_SUPPORT_ITEMS)}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-store-border border-t bg-store-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Link
            href={asRoute(buildHref('/account/login'))}
            prefetch={false}
            onClick={() => onClose('navigate')}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-full bg-store-primary px-4 py-2 font-bold text-sm text-store-primary-text motion-safe:transition-transform motion-safe:active:scale-[0.98] ${FOCUS_RING}`}
          >
            Login / Register
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <p className="mt-3 text-center text-store-background-text/75 text-xs">
            &copy; {businessName}
          </p>
        </div>
      </div>
    </div>
  );
};

export { MobileMenu as OgabasseyMobileMenu };
