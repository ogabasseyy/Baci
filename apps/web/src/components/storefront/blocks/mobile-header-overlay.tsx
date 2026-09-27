import { LogOut, Package, User, X } from 'lucide-react';
import Link from 'next/link';
import { HeaderSearch } from '@/components/storefront/blocks/header-search';
import { LoyaltyBadge } from '@/components/storefront/loyalty/loyalty-badge';
import { asRoute } from '@/lib/routes';
import type { CustomerSession } from './use-customer-session';

export type MobileHeaderOverlayMode = 'closed' | 'menu' | 'search';

/**
 * Mobile search/menu overlay panel (extracted from Header): the fullscreen
 * layer for the rewritten mobile menu and search overlay. Rendered markup
 * is unchanged; renders nothing unless the mode is open.
 */
export function MobileHeaderOverlay({
  customerSession,
  getHref,
  merchantId,
  mode,
  navigationLinks,
  onClose,
  onLogout,
  onSearchChange,
  searchRadius,
  searchStyle,
  searchValue,
  showAccount,
  showSearch,
  userId,
}: {
  customerSession: CustomerSession | null;
  getHref: (path: string) => string;
  merchantId: string | undefined;
  mode: MobileHeaderOverlayMode;
  navigationLinks: { label: string; url: string }[];
  onClose: () => void;
  onLogout: () => void;
  onSearchChange: (value: string) => void;
  searchRadius: 'none' | 'sm' | 'md' | 'full';
  searchStyle: 'outline' | 'filled' | 'minimal';
  searchValue: string;
  showAccount: boolean;
  showSearch: boolean;
  userId: string | undefined;
}) {
  if (mode === 'closed') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-background pt-24 px-6 md:hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-5 motion-safe:duration-200">
      <div className="flex flex-col gap-6">
        {mode === 'search' ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Search</h2>
              <button
                type="button"
                aria-label="Close search"
                onClick={onClose}
                className="p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            <HeaderSearch
              mobile
              onChange={onSearchChange}
              radius={searchRadius}
              style={searchStyle}
              value={searchValue}
            />
          </>
        ) : (
          <>
            {showSearch && (
              <HeaderSearch
                mobile
                onChange={onSearchChange}
                radius={searchRadius}
                style={searchStyle}
                value={searchValue}
              />
            )}
            <nav className="flex flex-col gap-4 text-lg font-medium">
              <Link href={asRoute(getHref('/'))} onClick={onClose}>
                Home
              </Link>
              {navigationLinks.map((link) => (
                <Link
                  key={link.label}
                  href={asRoute(getHref(link.url))}
                  onClick={onClose}
                >
                  {link.label}
                </Link>
              ))}
              {userId && merchantId && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full text-left"
                >
                  <LoyaltyBadge
                    merchantId={merchantId}
                    customerId={userId}
                    showPoints
                    rewardsHref={getHref('/pages/rewards')}
                  />
                </button>
              )}

              {/* Mobile Account Links */}
              {showAccount && (
                <div className="pt-4 border-t space-y-4">
                  {customerSession?.authenticated &&
                  customerSession.customer ? (
                    <>
                      <div className="text-sm text-current">
                        Signed in as {customerSession.customer.email}
                      </div>
                      <Link
                        href={asRoute(getHref('/account'))}
                        onClick={onClose}
                        className="flex items-center gap-2"
                      >
                        <User className="size-5" />
                        My Account
                      </Link>
                      <Link
                        href={asRoute(getHref('/account/orders'))}
                        onClick={onClose}
                        className="flex items-center gap-2"
                      >
                        <Package className="size-5" />
                        Orders
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          onLogout();
                          onClose();
                        }}
                        className="flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-destructive-foreground"
                      >
                        <LogOut className="size-5" />
                        Sign out
                      </button>
                    </>
                  ) : (
                    <Link
                      href={asRoute(getHref('/account/login'))}
                      onClick={onClose}
                      className="flex items-center gap-2"
                    >
                      <User className="size-5" />
                      Sign in
                    </Link>
                  )}
                </div>
              )}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
