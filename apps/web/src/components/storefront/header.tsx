'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Cart } from '@/components/cart';
import { Logo } from '@/components/logo';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import { CartIcon } from '@/components/ui/cart-icon';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { useStorefront } from '@/contexts/storefront-context';
import { useCart } from '@/hooks/use-cart';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute, routes } from '@/lib/routes';

import { SearchAutocomplete } from './search-autocomplete';

/**
 * StorefrontHeader - Now fully themeable via CSS variables
 *
 * All visual properties are controlled by the theme system:
 * - --theme-header-bg: Background color
 * - --theme-header-text: Text color
 * - --theme-header-icon: Icon color (menu, cart, all icons)
 * - --theme-header-search-border: Search border color
 * - --theme-header-search-bg: Search background color
 * - --theme-header-height: Header height
 * - --theme-header-px: Horizontal padding
 * - --theme-radius-md: Border radius for search
 */
export function StorefrontHeader() {
  const { merchant, basePath } = useMerchant();
  const { cartCount } = useCart();
  const { searchQuery, setSearchQuery } = useStorefront();
  const router = useRouter();

  if (!merchant) return null;

  const handleProductSelect = (url: string) => {
    // Strict validation: Only allow relative paths starting with /
    // Reject any URL that contains: protocol (http://, https://), double slashes (//), or backslashes
    const isValidRelativePath =
      url.startsWith('/') &&
      !url.startsWith('//') &&
      !url.includes('\\') &&
      !/^https?:\/\//i.test(url);

    if (isValidRelativePath) {
      router.push(asRoute(url));
    } else {
      console.warn('Invalid product URL rejected:', url);
    }
  };

  return (
    <Sheet>
      <header
        className="px-4 lg:px-6 flex items-center gap-4 shadow-sm sticky top-0 z-50 transition-colors"
        style={{
          backgroundColor: 'var(--theme-header-bg, #FFFFFF)',
          height: '4rem',
          minHeight: '4rem',
          maxHeight: '4rem',
          paddingLeft: 'var(--theme-header-px, 1rem)',
          paddingRight: 'var(--theme-header-px, 1rem)',
          color: 'var(--theme-header-text, #000000)',
        }}
      >
        <Link
          href={asRoute(basePath || '/')}
          className="flex items-center gap-3 font-semibold shrink-0"
        >
          {merchant.logo_url ? (
            <Image
              src={merchant.logo_url}
              alt={`${merchant.business_name} logo`}
              width={160}
              height={48}
              className="h-10 sm:h-12 w-auto max-w-[140px] sm:max-w-[160px] object-contain"
              priority
            />
          ) : (
            <Logo />
          )}
          {!merchant.logo_url && (
            <span className="hidden sm:inline-block">
              {merchant.business_name}
            </span>
          )}
        </Link>

        <div className="flex-1 flex justify-center px-4">
          <SearchAutocomplete
            merchantId={merchant.id}
            value={searchQuery}
            onChange={setSearchQuery}
            onSelectProduct={handleProductSelect}
            placeholder="Search products..."
            className="w-full max-w-md"
            countryCode={merchant.country}
            payoutCurrency={merchant.payout_currency}
          />
        </div>

        <nav className="flex items-center gap-2 sm:gap-4">
          <Link href={routes.dashboardOrders}>
            <ThemedButton colorRole="primary">My Dashboard</ThemedButton>
          </Link>
          {/* Repair booking is an Ogabassey-template feature; /repair 404s on other stores */}
          {merchant.slug && merchant.template_id === OGABASSEY_TEMPLATE_ID && (
            <Link href={routes.storefrontRepair(merchant.slug)}>
              <Button variant="ghost">Book Repair</Button>
            </Link>
          )}
          <SheetTrigger asChild>
            {/* Touch target meets WCAG 2.5.5 minimum (44px) */}
            <Button
              variant="outline"
              size="icon"
              className="relative touch-manipulation size-11 min-w-[44px] min-h-[44px]"
              style={{ color: 'var(--theme-header-icon, #000000)' }}
            >
              <CartIcon count={cartCount} size={20} />
              <span className="sr-only">Cart ({cartCount} items)</span>
            </Button>
          </SheetTrigger>
        </nav>
      </header>
      <Cart />
    </Sheet>
  );
}
