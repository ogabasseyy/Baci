'use client';

import {
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  ShoppingBag,
  User,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cart } from '@/components/cart';
import { Logo } from '@/components/logo';
import { getStorefrontNavigationHref } from '@/components/storefront/blocks/get-storefront-navigation-href';
import { HeaderNavigation } from '@/components/storefront/blocks/header-navigation';
import { HeaderSearch } from '@/components/storefront/blocks/header-search';
import { useMobileHeaderPanel } from '@/components/storefront/blocks/use-mobile-header-panel';
import { LoyaltyBadge } from '@/components/storefront/loyalty/loyalty-badge';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

  // Customer auth state - we use a simple fetch approach since context may not be available
  const [customerSession, setCustomerSession] = useState<{
    authenticated: boolean;
    customer: { first_name: string; last_name: string; email: string } | null;
  } | null>(null);

  // Check customer session
  useEffect(() => {
    const merchantSlug = merchant?.slug;
    if (!showAccount || !merchantSlug || isPreview) return;

    const checkSession = async () => {
      try {
        const response = await fetch(
          `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
        );
        const data = await response.json();
        setCustomerSession({
          authenticated: data.authenticated || false,
          customer: data.customer || null,
        });
      } catch {
        setCustomerSession({ authenticated: false, customer: null });
      }
    };

    checkSession();
  }, [showAccount, merchant?.slug, isPreview]);

  const handleLogout = async () => {
    try {
      await fetch('/api/storefront/auth/logout', { method: 'POST' });
      setCustomerSession({ authenticated: false, customer: null });
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

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
            <Link
              href={asRoute(getHref('/'))}
              className={cn('flex items-center gap-2 group shrink-0', {
                'order-1': layout !== 'logo-center',
                'order-2 mx-auto': layout === 'logo-center',
              })}
            >
              {finalLogoUrl ? (
                <Image
                  src={finalLogoUrl}
                  alt={finalStoreName}
                  width={40}
                  height={40}
                  className="rounded-full object-cover ring-2 ring-white/50 shadow-sm transition-transform group-hover:scale-105"
                />
              ) : (
                <Logo className="transition-transform group-hover:scale-105" />
              )}
              <span
                className={cn(
                  'font-bold text-xl tracking-tight transition-colors'
                )}
              >
                {finalStoreName}
              </span>
            </Link>
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
            {showAccount &&
              (customerSession?.authenticated && customerSession.customer ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="User account"
                      className="p-2 hover:bg-black/5 rounded-full transition-colors group hidden sm:block"
                    >
                      <User className="size-5 group-hover:scale-110 transition-transform" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col gap-y-1">
                        <p className="text-sm font-medium leading-none">
                          {[
                            customerSession.customer.first_name,
                            customerSession.customer.last_name,
                          ]
                            .filter(Boolean)
                            .join(' ') || 'Customer'}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {customerSession.customer.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link
                        href={asRoute(getHref('/account'))}
                        className="cursor-pointer"
                      >
                        <User className="mr-2 size-4" />
                        My Account
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href={asRoute(getHref('/account/orders'))}
                        className="cursor-pointer"
                      >
                        <Package className="mr-2 size-4" />
                        Orders
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href={asRoute(getHref('/account/settings'))}
                        className="cursor-pointer"
                      >
                        <Settings className="mr-2 size-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="cursor-pointer text-destructive focus:bg-destructive focus:text-destructive-foreground"
                    >
                      <LogOut className="mr-2 size-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="hidden sm:inline-flex"
                >
                  <Link href={asRoute(getHref('/account/login'))}>Sign in</Link>
                </Button>
              ))}

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
      {mobilePanel.mode !== 'closed' && (
        <div className="fixed inset-0 z-40 bg-background pt-24 px-6 md:hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-5 motion-safe:duration-200">
          <div className="flex flex-col gap-6">
            {mobilePanel.mode === 'search' ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium">Search</h2>
                  <button
                    type="button"
                    aria-label="Close search"
                    onClick={mobilePanel.close}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <HeaderSearch
                  mobile
                  onChange={setSearchQuery}
                  radius={searchRadius}
                  style={searchStyle}
                  value={searchQuery}
                />
              </>
            ) : (
              <>
                {showSearch && (
                  <HeaderSearch
                    mobile
                    onChange={setSearchQuery}
                    radius={searchRadius}
                    style={searchStyle}
                    value={searchQuery}
                  />
                )}
                <nav className="flex flex-col gap-4 text-lg font-medium">
                  <Link
                    href={asRoute(getHref('/'))}
                    onClick={mobilePanel.close}
                  >
                    Home
                  </Link>
                  {navigationLinks.map((link) => (
                    <Link
                      key={link.label}
                      href={asRoute(getHref(link.url))}
                      onClick={mobilePanel.close}
                    >
                      {link.label}
                    </Link>
                  ))}
                  {user && merchant?.id && (
                    <button
                      type="button"
                      onClick={mobilePanel.close}
                      className="w-full text-left"
                    >
                      <LoyaltyBadge
                        merchantId={merchant.id}
                        customerId={user.id}
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
                            onClick={mobilePanel.close}
                            className="flex items-center gap-2"
                          >
                            <User className="size-5" />
                            My Account
                          </Link>
                          <Link
                            href={asRoute(getHref('/account/orders'))}
                            onClick={mobilePanel.close}
                            className="flex items-center gap-2"
                          >
                            <Package className="size-5" />
                            Orders
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              handleLogout();
                              mobilePanel.close();
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
                          onClick={mobilePanel.close}
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
      )}
      <Cart />
    </Sheet>
  );
}
