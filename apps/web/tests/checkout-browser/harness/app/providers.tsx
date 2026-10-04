'use client';
import type { ReactNode } from 'react';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchant } from '../../fixtures';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StorefrontMerchantProvider
      initialMerchant={merchant}
      initialRoutingMode="domain"
    >
      <StorefrontCartProvider merchantSlug={merchant.slug}>
        {children}
      </StorefrontCartProvider>
    </StorefrontMerchantProvider>
  );
}
