'use client';
// Migrated from temp-source/components/MobileMenu.tsx
import {
  Crown,
  FileText,
  Heart,
  HelpCircle,
  MapPin,
  RefreshCw,
  ScanBarcode,
  ShoppingBag,
  Star,
  User,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect } from 'react';

import { useV2Theme } from '../providers/v2-theme-context';
import { Logo } from './Logo';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  storeSlug?: string;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  storeSlug: propStoreSlug,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const { theme: _theme } = useV2Theme();

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

  // Extract store slug from pathname (first segment that's not a known page route)
  // e.g., "/ogabassey/cart" -> "ogabassey", "/cart" -> ""
  const pathSegments = pathname?.split('/').filter(Boolean) || [];
  const knownRoutes = [
    'account',
    'cart',
    'checkout',
    'products',
    'wishlist',
    'wallet',
    'repairs',
    'imei-check',
    'pages',
  ];
  const firstSegment = pathSegments[0] || '';
  const derivedStoreSlug = knownRoutes.includes(firstSegment)
    ? ''
    : firstSegment;
  const storeSlug = propStoreSlug || derivedStoreSlug;

  if (!isOpen) return null;

  const handleNavigate = (path: string) => {
    // Prepend store slug if we're in path-based routing mode
    const fullPath = storeSlug ? `/${storeSlug}${path}` : path;
    router.push(fullPath as any);
    onClose();
  };

  const menuItems = [
    { label: 'Profile', icon: User, path: '/account' },
    { label: 'Member Status', icon: Crown, path: '/member-status' },
    { label: 'Orders', icon: ShoppingBag, path: '/account/orders' },
    { label: 'Saved Items', icon: Heart, path: '/wishlist' },
    { label: 'IMEI Checker', icon: ScanBarcode, path: '/imei-check' },
    { label: 'Wallet', icon: Wallet, path: '/wallet' },
    { label: 'Receipts', icon: FileText, path: '/receipts' },
    { label: 'Address Book', icon: MapPin, path: '/account/addresses' },
    { label: 'Repairs', icon: Wrench, path: '/repairs' },
    { label: 'Swap / Trade-in', icon: RefreshCw, path: '/swap' },
    { label: 'My Reviews', icon: Star, path: '/reviews' },
    { label: 'Help & Support', icon: HelpCircle, path: '/pages/faq' },
  ];

  return (
    <div className="fixed inset-0 z-100">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Dismiss menu backdrop"
        tabIndex={-1}
      />

      {/* Sidebar */}
      <div className="absolute inset-y-0 left-0 w-[85%] max-w-[320px] bg-white shadow-2xl animate-in slide-in-from-left duration-300 flex flex-col">
        <div className="px-3 py-4 border-b border-gray-100 flex items-center justify-between">
          <Logo className="h-7 w-auto text-gray-900" />
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 hide-scrollbar">
          {/* Account & Help */}
          <div className="px-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Account
            </h3>
            <div className="space-y-1">
              {menuItems.map((item) => {
                const isActive = pathname === item.path;
                return (
                  <button type="button"
                    key={item.label}
                    onClick={() => handleNavigate(item.path)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors text-sm group ${isActive ? 'bg-red-50 text-red-600 font-bold' : 'hover:bg-gray-50 text-gray-700 font-medium'}`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon
                        size={18}
                        className={
                          isActive
                            ? 'text-red-600'
                            : 'text-gray-400 group-hover:text-red-600'
                        }
                      />
                      {item.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-3 py-4 border-t border-gray-100 bg-gray-50">
            <button type="button"
              onClick={() => handleNavigate('/account/login')}
              className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-95 transition-transform"
            >
              Login / Register
            </button>
            <p className="text-center text-[10px] text-gray-400 mt-3">
              v1.0.0 • © Ogabassey
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
