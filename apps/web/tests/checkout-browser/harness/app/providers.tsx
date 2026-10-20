'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchant } from '../../fixtures';

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const skipRootCartProvider =
    pathname === '/checkout-shared' || pathname === '/payment-handoff';
  return (
    <StorefrontMerchantProvider
      initialMerchant={merchant}
      initialRoutingMode="domain"
    >
      {skipRootCartProvider ? (
        children
      ) : (
        <StorefrontCartProvider merchantSlug={merchant.slug}>
          {children}
        </StorefrontCartProvider>
      )}
    </StorefrontMerchantProvider>
  );
}
