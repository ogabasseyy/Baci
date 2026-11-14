'use client';

import { X } from 'lucide-react';
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
    <div className="mb-5 px-4 last:mb-0">
      <h2 className="mb-2 px-1 font-bold text-store-background-text/60 text-xs uppercase tracking-widest">
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
                className={`group flex w-full items-center justify-between rounded-xl p-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-store-primary/10 font-bold text-store-primary'
                    : 'font-medium text-store-background-text/80 hover:bg-store-background-text/5'
                }`}
              >
                <span className="flex items-center gap-3">
                  <item.icon
                    size={18}
                    aria-hidden="true"
                    className={
                      isActive
                        ? 'text-store-primary'
                        : 'text-store-background-text/50 group-hover:text-store-primary'
                    }
                  />
                  {item.label}
                </span>
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
        className="fade-in absolute inset-0 animate-in bg-black/60 duration-200 backdrop-blur-xs"
        onClick={() => onClose('dismiss')}
      />

      {/* Sidebar */}
      <div className="slide-in-from-left absolute inset-y-0 left-0 flex w-[85%] max-w-[320px] flex-col border-store-border border-r bg-store-background text-store-background-text shadow-2xl animate-in duration-300">
        <div className="flex items-center justify-between border-store-border border-b px-4 py-4">
          <Logo
            className="h-8 w-auto text-store-background-text"
            color="current"
          />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={() => onClose('dismiss')}
            className="rounded-full p-2 text-store-background-text/70 transition-colors hover:bg-store-background-text/10 hover:text-store-background-text"
            aria-label="Close menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav
          aria-label="Mobile storefront navigation"
          className="hide-scrollbar flex-1 overflow-y-auto py-4"
        >
          {renderSection('Shop & Services', MOBILE_MENU_SHOP_ITEMS)}

          {normalizedCategories.length > 0 && (
            <div className="mb-5 px-4">
              <h2 className="mb-2 px-1 font-bold text-store-background-text/60 text-xs uppercase tracking-widest">
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
                      className="inline-flex items-center rounded-full bg-store-background-text/10 px-3 py-1.5 font-medium text-store-background-text/80 text-xs transition-colors hover:bg-store-primary/10 hover:text-store-primary"
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
        <div className="border-store-border border-t bg-store-background-text/5 p-4">
          <Link
            href={asRoute(buildHref('/account/login'))}
            prefetch={false}
            onClick={() => onClose('navigate')}
            className="block w-full rounded-xl bg-store-primary py-3.5 text-center font-bold text-store-primary-text shadow-lg transition-transform active:scale-95"
          >
            Login / Register
          </Link>
          <p className="mt-3 text-center text-store-background-text/60 text-xs">
            &copy; {businessName}
          </p>
        </div>
      </div>
    </div>
  );
};

export { MobileMenu as OgabasseyMobileMenu };
