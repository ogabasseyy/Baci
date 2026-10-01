'use client';

import { Menu, Search, ShoppingBag, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cart } from '@/components/cart';
import { getStorefrontNavigationHref } from '@/components/storefront/blocks/get-storefront-navigation-href';
import { HeaderAccountMenu } from '@/components/storefront/blocks/header-account-menu';
import { HeaderLogo } from '@/components/storefront/blocks/header-logo';
import { HeaderNavigation } from '@/components/storefront/blocks/header-navigation';
import { HeaderSearch } from '@/components/storefront/blocks/header-search';
import { MobileHeaderOverlay } from '@/components/storefront/blocks/mobile-header-overlay';
import { useCustomerSession } from '@/components/storefront/blocks/use-customer-session';
import { useMobileHeaderPanel } from '@/components/storefront/blocks/use-mobile-header-panel';
import { LoyaltyBadge } from '@/components/storefront/loyalty/loyalty-badge';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { useAuthSafe } from '@/contexts/auth-context';
import { useCart } from '@/hooks/use-cart';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

export interface HeaderProps {
  showLogo?: boolean;
  showSearch?: boolean;
  showCart?: boolean;
  showMenu?: boolean;
  showAccount?: boolean;
  navigationLinks?: { label: string; url: string }[];
  ctaButton?: {
    text: string;
    url: string;
    show: boolean;
  };
  backgroundColor?: string;
  textColor?: string;
  sticky?: boolean;
  logoUrl?: string;
  storeName?: string;
  layout?: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  searchStyle?: 'outline' | 'filled' | 'minimal';
  searchRadius?: 'none' | 'sm' | 'md' | 'full';
  paddingY?: 'sm' | 'md' | 'lg';
  glassEffect?: boolean;
  backgroundImage?: string;
  isPreview?: boolean;
}

export function Header({
  showLogo = true,
  showSearch = true,
  showCart = true,
  showMenu = true,
  showAccount = true,
  navigationLinks = [],
  ctaButton,
  backgroundColor,
  textColor,
  sticky = true,
  logoUrl,
  storeName,
  layout = 'logo-left-nav-center',
  searchStyle = 'outline',
  searchRadius = 'full',
  paddingY = 'md',
  glassEffect = true,
  backgroundImage,
  isPreview = false,
}: HeaderProps) {
  const { merchant, basePath } = useMerchant();
  const { cartCount } = useCart();
  const auth = useAuthSafe();
  const user = auth?.user ?? null;
  const [isScrolled, setIsScrolled] = useState(false);
  const mobilePanel = useMobileHeaderPanel();
  const [searchQuery, setSearchQuery] = useState('');

  const getHref = (path: string) => getStorefrontNavigationHref(path, basePath);

  const { customerSession, handleLogout } = useCustomerSession({
    showAccount,
    merchantSlug: merchant?.slug,
    isPreview,
  });
  // Use merchant data if props are missing (fallback for template usage)
  const finalLogoUrl = logoUrl || merchant?.logo_url;
  const finalStoreName = storeName || merchant?.business_name || 'Store';

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const paddingClasses = {
    sm: 'py-2',
    md: 'py-4',
    lg: 'py-6',
  };

  // Determine effective text color based on scroll state and glass effect
  const effectiveTextColor =
    isScrolled || !glassEffect ? textColor || 'inherit' : 'white';
  const effectiveBgColor = isScrolled
    ? glassEffect
      ? 'rgba(255, 255, 255, 0.8)'
      : backgroundColor || 'white'
    : glassEffect
      ? 'transparent'
      : backgroundColor || 'white';

  return (
    <Sheet>
      <header
        className={cn(
          'w-full z-50 transition-all duration-300 px-4 md:px-8 overflow-hidden',
          sticky ? 'fixed top-0 left-0 right-0' : 'relative',
          isScrolled && glassEffect ? 'backdrop-blur-md shadow-sm' : '',
          paddingClasses[paddingY]
        )}
        style={{
          backgroundColor: effectiveBgColor,
          color: effectiveTextColor,
        }}
      >
        {/* Background Image Pattern */}
        {backgroundImage && (
          <div
            className="absolute inset-0 z-[-1] opacity-20 pointer-events-none"
            style={{
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />
        )}
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo Section */}
          {showLogo && (
            <HeaderLogo
              getHref={getHref}
              layout={layout}
              logoUrl={finalLogoUrl}
              storeName={finalStoreName}
            />
          )}
          {/* Desktop Navigation */}
          {showMenu && navigationLinks.length > 0 && (
            <HeaderNavigation
              getHref={getHref}
              layout={layout}
              links={navigationLinks}
            />
          )}

          {/* Search Bar (Desktop) */}
          {showSearch && (
            <HeaderSearch
              glassEffect={glassEffect}
              isScrolled={isScrolled}
              layout={layout}
              onChange={setSearchQuery}
              radius={searchRadius}
              style={searchStyle}
              value={searchQuery}
            />
          )}

          {/* Actions (Cart, Mobile Menu, CTA) */}
          <div
            className={cn('flex items-center gap-3 shrink-0', {
              'order-4 ml-auto': true,
            })}
          >
            {ctaButton?.show && ctaButton.text && (
              <ThemedButton
                asChild
                colorRole="primary"
                size="sm"
                className="hidden sm:inline-flex rounded-full"
              >
                <Link href={asRoute(getHref(ctaButton.url))}>
                  {ctaButton.text}
                </Link>
              </ThemedButton>
            )}

            {showSearch && (
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Search"
                onClick={mobilePanel.openSearch}
              >
                <Search className="size-5" />
              </Button>
            )}

            {/* Loyalty Badge - shows when user is logged in and enrolled */}
            {user && merchant?.id && (
              <LoyaltyBadge
                merchantId={merchant.id}
                customerId={user.id}
                compact
                className="hidden sm:flex"
                rewardsHref={getHref('/pages/rewards')}
              />
            )}

            {/* Customer Account */}
            {showAccount && (
              <HeaderAccountMenu
                customerSession={customerSession}
                getHref={getHref}
                onLogout={handleLogout}
              />
            )}
            {showCart && (
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Shopping cart"
                  className="relative p-2 hover:bg-black/5 rounded-full transition-colors group"
                >
                  <ShoppingBag className="size-5 group-hover:scale-110 transition-transform" />
                  {cartCount > 0 && (
                    <span className="absolute top-0 right-0 size-4 bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center rounded-full shadow-sm animate-in zoom-in">
                      {cartCount}
                    </span>
                  )}
                </button>
              </SheetTrigger>
            )}

            {showMenu && (
              <button
                type="button"
                aria-label="Toggle menu"
                onClick={
                  mobilePanel.mode === 'menu'
                    ? mobilePanel.close
                    : mobilePanel.openMenu
                }
                className="md:hidden p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                {mobilePanel.mode === 'menu' ? (
                  <X className="size-6" />
                ) : (
                  <Menu className="size-6" />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <MobileHeaderOverlay
        customerSession={customerSession}
        getHref={getHref}
        merchantId={merchant?.id}
        mode={mobilePanel.mode}
        navigationLinks={navigationLinks}
        onClose={mobilePanel.close}
        onLogout={handleLogout}
        onSearchChange={setSearchQuery}
        searchRadius={searchRadius}
        searchStyle={searchStyle}
        searchValue={searchQuery}
        showAccount={showAccount}
        showSearch={showSearch}
        userId={user?.id}
      />
      <Cart />
    </Sheet>
  );
}
