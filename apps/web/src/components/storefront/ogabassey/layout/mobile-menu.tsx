'use client';

import {
  Crown,
  FileText,
  Heart,
  HelpCircle,
  Home,
  LayoutGrid,
  MapPin,
  MessageSquare,
  Newspaper,
  Package,
  RefreshCw,
  ScanBarcode,
  ShoppingBag,
  Star,
  User,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useEffect } from 'react';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { asRoute } from '@/lib/routes';
import { Logo } from './logo';

export interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  logo?: string;
  storeSlug?: string;
}

interface MobileMenuItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const KNOWN_TOP_LEVEL_ROUTES = new Set([
  'about',
  'account',
  'blog',
  'cart',
  'checkout',
  'contact',
  'faq',
  'imei-check',
  'member-status',
  'pages',
  'privacy',
  'products',
  'receipts',
  'repairs',
  'reviews',
  'swap',
  'terms',
  'track-order',
  'wallet',
  'wishlist',
]);

function resolveMobileMenuBasePath(
  propStoreSlug: string | undefined,
  merchantBasePath: string | undefined,
  pathname: string | null
): string {
  const candidate = propStoreSlug ?? merchantBasePath;
  if (candidate !== undefined) {
    const trimmed = candidate.trim().replace(/^\/+|\/+$/g, '');
    return trimmed ? `/${trimmed}` : '';
  }

  const firstSegment = pathname?.split('/').filter(Boolean)[0] || '';
  if (!firstSegment || KNOWN_TOP_LEVEL_ROUTES.has(firstSegment)) {
    return '';
  }

  return `/${firstSegment}`;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  storeSlug,
}) => {
  const pathname = usePathname();
  const merchantContext = useMerchantSafe();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const basePath = resolveMobileMenuBasePath(
    storeSlug,
    merchantContext?.basePath,
    pathname
  );
  const businessName = merchantContext?.merchant?.business_name || 'Ogabassey';
  const categories = merchantContext?.navigationCategories ?? [];

  const buildHref = (path: string) => {
    if (path === '/') {
      return basePath || '/';
    }
    return `${basePath}${path}`;
  };

  const matchesPath = (path: string) => {
    const fullPath = buildHref(path);
    if (path === '/') {
      return pathname === fullPath || pathname === `${fullPath}/`;
    }
    return pathname === fullPath || Boolean(pathname?.startsWith(`${fullPath}/`));
  };

  const shopItems: MobileMenuItem[] = [
    { label: 'Home', icon: Home, path: '/' },
    { label: 'All Products', icon: LayoutGrid, path: '/products' },
    { label: 'Swap / Trade-in', icon: RefreshCw, path: '/swap' },
    { label: 'IMEI Checker', icon: ScanBarcode, path: '/imei-check' },
    { label: 'Repairs', icon: Wrench, path: '/repairs' },
    { label: 'Blog', icon: Newspaper, path: '/blog' },
  ];

  const accountItems: MobileMenuItem[] = [
    { label: 'My Account', icon: User, path: '/account' },
    { label: 'Wallet', icon: Wallet, path: '/wallet' },
    { label: 'Saved Items', icon: Heart, path: '/wishlist' },
    { label: 'Orders', icon: ShoppingBag, path: '/account/orders' },
    { label: 'Member Status', icon: Crown, path: '/member-status' },
    { label: 'Receipts', icon: FileText, path: '/receipts' },
    { label: 'Address Book', icon: MapPin, path: '/account/addresses' },
    { label: 'My Reviews', icon: Star, path: '/reviews' },
  ];

  const supportItems: MobileMenuItem[] = [
    { label: 'Track Order', icon: Package, path: '/track-order' },
    { label: 'Help & Support', icon: HelpCircle, path: '/faq' },
    { label: 'Contact Us', icon: MessageSquare, path: '/contact' },
  ];

  const activePath = [...shopItems, ...accountItems, ...supportItems]
    .map((item) => item.path)
    .filter(matchesPath)
    .sort((a, b) => b.length - a.length)[0];

  const isItemActive = (path: string) => path === activePath;

  const renderSection = (title: string, items: MobileMenuItem[]) => (
    <div className="px-4 mb-5 last:mb-0">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">
        {title}
      </h3>
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive = isItemActive(item.path);
          return (
            <li key={item.path}>
              <Link
                href={asRoute(buildHref(item.path))}
                prefetch={false}
                onClick={onClose}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-sm group ${
                  isActive
                    ? 'bg-store-primary/10 text-store-primary font-bold'
                    : 'hover:bg-gray-50 text-gray-700 font-medium'
                }`}
              >
                <span className="flex items-center gap-3">
                  <item.icon
                    size={18}
                    aria-hidden="true"
                    className={
                      isActive
                        ? 'text-store-primary'
                        : 'text-gray-400 group-hover:text-store-primary'
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
      role="dialog"
      aria-modal="true"
      aria-label="Mobile menu"
      data-open="true"
      className="fixed inset-0 z-100"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Dismiss menu backdrop"
        tabIndex={-1}
        className="absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="absolute inset-y-0 left-0 w-[85%] max-w-[320px] bg-white shadow-2xl animate-in slide-in-from-left duration-300 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <Logo className="h-8 w-auto" color="black" />
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500"
            aria-label="Close menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav
          aria-label="Mobile storefront navigation"
          className="flex-1 overflow-y-auto py-4 hide-scrollbar"
        >
          {renderSection('Shop & Services', shopItems)}

          {categories.length > 0 && (
            <div className="px-4 mb-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">
                Categories
              </h3>
              <ul className="flex flex-wrap gap-1.5 px-1">
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={asRoute(buildHref(`/${category.slug}`))}
                      prefetch={false}
                      onClick={onClose}
                      className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-store-primary/10 hover:text-store-primary transition-colors"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {renderSection('Account & Wallet', accountItems)}
          {renderSection('Support', supportItems)}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <Link
            href={asRoute(buildHref('/account/login'))}
            prefetch={false}
            onClick={onClose}
            className="block w-full text-center bg-gray-900 text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Login / Register
          </Link>
          <p className="text-center text-xs text-gray-500 mt-3">
            &copy; {businessName}
          </p>
        </div>
      </div>
    </div>
  );
};

export { MobileMenu as OgabasseyMobileMenu };
