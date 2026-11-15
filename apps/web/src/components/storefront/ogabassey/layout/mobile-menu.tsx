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
import styles from './mobile-menu.module.css';
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
    <div className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      <ul className={styles.menuList}>
        {items.map((item) => {
          const isActive = item.path === activePath;
          return (
            <li key={item.path}>
              <Link
                href={asRoute(buildHref(item.path))}
                prefetch={false}
                onClick={() => onClose('navigate')}
                aria-current={isActive ? 'page' : undefined}
                className={styles.menuLink}
              >
                <span className={styles.linkLabel}>
                  <span
                    className={styles.iconTile}
                  >
                    <item.icon size={17} aria-hidden="true" />
                  </span>
                  {item.label}
                </span>
                {item.path === '/swap' || item.path === '/repairs' ? (
                  <Leaf
                    className={styles.leaf}
                    size={16}
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className={styles.chevron}
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
      className={styles.dialog}
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div
        role="presentation"
        className={styles.backdrop}
        onClick={() => onClose('dismiss')}
      />

      {/* Sidebar */}
      <div className={styles.panel}>
        <div className={styles.header}>
          <Logo
            className={styles.logo}
            color="current"
          />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={() => onClose('dismiss')}
            className={styles.close}
            aria-label="Close menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav
          aria-label="Mobile storefront navigation"
          className={styles.navigation}
        >
          {renderSection('Shop & Services', MOBILE_MENU_SHOP_ITEMS)}

          {normalizedCategories.length > 0 && (
            <div className={styles.categorySection}>
              <h2 className={styles.heading}>Categories</h2>
              <ul className={styles.categories}>
                {normalizedCategories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={asRoute(
                        buildHref(`/${encodeURIComponent(category.slug)}`)
                      )}
                      prefetch={false}
                      onClick={() => onClose('navigate')}
                      className={styles.categoryLink}
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
        <div className={styles.footer}>
          <Link
            href={asRoute(buildHref('/account/login'))}
            prefetch={false}
            onClick={() => onClose('navigate')}
            className={styles.login}
          >
            Login / Register
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <p className={styles.copyright}>
            &copy; {businessName}
          </p>
        </div>
      </div>
    </div>
  );
};

export { MobileMenu as OgabasseyMobileMenu };
