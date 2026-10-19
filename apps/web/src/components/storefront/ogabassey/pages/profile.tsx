'use client';

import {
  Bell,
  ChevronRight,
  Heart,
  HelpCircle,
  History,
  LogOut,
  MapPin,
  Package,
  Settings,
  Shield,
  User,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';

import { useToast } from '@/hooks/use-toast';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useV2Saved } from '@/components/storefront/ogabassey/providers/v2-saved-context';

// Extract store slug from pathname
function useStoreSlug() {
  const pathname = usePathname();
  const pathSegments = pathname?.split('/').filter(Boolean) || [];
  const knownRoutes = ['account', 'cart', 'checkout', 'products', 'wishlist', 'wallet', 'repairs', 'imei-check', 'pages'];
  const firstSegment = pathSegments[0] || '';
  return knownRoutes.includes(firstSegment) ? '' : firstSegment;
}

const getMenuItems = (storeSlug: string) => {
  const prefix = storeSlug ? `/${storeSlug}` : '';
  return [
    {
      icon: Package,
      label: 'My Orders',
      desc: 'Track, return, or buy again',
      link: `${prefix}/account/orders`,
    },
    {
      icon: History,
      label: 'Purchase History',
      desc: 'Browse past items',
      link: `${prefix}/purchase-history`,
    },
    {
      icon: Heart,
      label: 'Saved Items',
      desc: 'Your wishlist',
      link: `${prefix}/wishlist`,
    },
    {
      icon: Wallet,
      label: 'My Wallet',
      desc: 'Manage balance & cards',
      link: `${prefix}/wallet`,
    },
    {
      icon: MapPin,
      label: 'Addresses',
      desc: 'Edit delivery locations',
      link: `${prefix}/account/addresses`,
    },
    {
      icon: Bell,
      label: 'Notifications',
      desc: 'Offers & order updates',
      link: `${prefix}/notifications`,
    },
    {
      icon: Shield,
      label: 'Security',
      desc: 'Password & 2FA',
      link: `${prefix}/security`,
    },
    {
      icon: HelpCircle,
      label: 'Help & Support',
      desc: 'FAQs & customer care',
      link: `${prefix}/pages/faq`,
    },
  ];
};

export const OgabasseyV2Profile: React.FC = () => {
  const { toast } = useToast();
  const storeSlug = useStoreSlug();
  const menuItems = getMenuItems(storeSlug);
  const { customer, logout, isAuthenticated } = useCustomerAuth();
  const { savedItems } = useV2Saved();

  // Helper for initials
  const getInitials = (name?: string) => {
    return name
      ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
      : '??';
  };

  if (!isAuthenticated && typeof window !== 'undefined') {
    // Ideally redirect, but for this component just show minimal or empty
    // return null;
  }

  const displayName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || customer?.email || 'Guest';
  const displayEmail = customer?.email || '';
  const displayPhone = customer?.phone || 'No phone added';

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        {/* Header */}
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2 shrink-0">
          <User className="text-red-600 fill-red-600" />
          My Profile
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Profile Card */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-24 bg-linear-to-r from-gray-900 to-gray-800" />

              <div className="relative size-24 rounded-full border-4 border-white shadow-md mb-4 mt-8 bg-gray-200 flex items-center justify-center">
                {/* Replaced Image with Initials fallback if no generic avatar */}
                <span className="text-2xl font-bold text-gray-600">
                  {getInitials(displayName)}
                </span>

                <button
                  type="button"
                  className="absolute bottom-0 right-0 bg-red-600 text-white p-1.5 rounded-full border-2 border-white hover:bg-red-700 transition-colors"
                  aria-label="Edit profile settings"
                >
                  <Settings size={14} />
                </button>
              </div>

              <h2 className="text-xl font-bold text-gray-900">{displayName}</h2>
              <p className="text-gray-500 text-sm mb-1">{displayEmail}</p>
              <p className="text-gray-400 text-xs mb-6">{displayPhone}</p>

              <div className="w-full grid grid-cols-2 gap-4 border-t border-gray-100 pt-6">
                <div className="text-center">
                  <span className="block text-lg font-bold text-gray-900">
                    {customer?.total_orders || 0}
                  </span>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">
                    Orders
                  </span>
                </div>
                <div className="text-center border-l border-gray-100">
                  <span className="block text-lg font-bold text-gray-900">
                    {savedItems.length}
                  </span>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">
                    Saved
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-red-50 rounded-2xl p-6 border border-red-100">
              <h3 className="font-bold text-red-900 mb-2">
                Premium Membership
              </h3>
              <p className="text-sm text-red-700 mb-4">
                Unlock free delivery and exclusive deals.
              </p>
              <button
                type="button"
                className="w-full bg-red-600 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-red-700 transition-colors shadow-sm active:scale-95"
              >
                Upgrade Now
              </button>
            </div>
          </div>

          {/* Right Column: Menu */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {menuItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.link as any}
                  className="flex items-center justify-between p-4 md:p-6 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors group active:bg-gray-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="size-10 rounded-full bg-gray-50 text-gray-600 flex items-center justify-center group-hover:bg-red-50 group-hover:text-red-600 transition-colors">
                      <item.icon size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm md:text-base">
                        {item.label}
                      </h4>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                  </div>
                  <ChevronRight
                    size={18}
                    className="text-gray-300 group-hover:text-red-600 transition-colors"
                  />
                </Link>
              ))}

              <button
                type="button"
                onClick={() => void logout().catch(() => toast({title:'Could not sign out',description:'Please reconnect and try again.',variant:'destructive'}))}
                className="w-full flex items-center justify-between p-4 md:p-6 hover:bg-red-50 transition-colors group text-left active:bg-red-100"
              >
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                    <LogOut size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-red-600 text-sm md:text-base">
                      Log Out
                    </h4>
                    <p className="text-xs text-red-400">
                      Securely sign out of your account
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
