import { notFound } from 'next/navigation';
import type React from 'react';
import { DeferredPageViewTracker } from '@/components/storefront/deferred-page-view-tracker';
import { WebMcpStorefrontTools } from '@/components/storefront/webmcp-storefront-tools';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { StorefrontLayoutRenderer } from './storefront-layout-renderer';
import type { getStorefrontShellSnapshot } from './storefront-shell-snapshot';

export function StorefrontShellFrame({
  children,
  preloadHeroLcpImages,
  shellSnapshot,
}: {
  children: React.ReactNode;
  preloadHeroLcpImages: boolean;
  shellSnapshot: Awaited<ReturnType<typeof getStorefrontShellSnapshot>>;
}) {
  if (!shellSnapshot) {
    notFound();
  }

  const { merchant, routingMode } = shellSnapshot;
  const merchantSlug = merchant.slug || '';

  return (
    <StorefrontMerchantProvider
      slug={merchantSlug}
      shellSnapshot={shellSnapshot}
    >
      <StorefrontCartProvider
        enableSmartCartPro
        merchantId={merchant.id}
        merchantSlug={merchantSlug}
        sharedCartEnabled={merchantHasFeature(merchant, 'shared_cart')}
        sharedCartRealtimeEnabled={merchantHasFeature(
          merchant,
          'shared_cart_realtime'
        )}
        deferValidationUntilIdle
      >
        <WebMcpStorefrontTools
          merchantId={merchant.id}
          merchantSlug={merchantSlug}
        />
        <DeferredPageViewTracker merchantId={merchant.id} />
        {/*
          Global Layout Wrapper logic:
          - Keeps layout persistent across route changes (seamless navigation)
          - Prevents header flashing/re-rendering
        */}
        <StorefrontLayoutRenderer
          merchant={merchant}
          preloadHeroLcpImages={preloadHeroLcpImages}
          routingMode={routingMode}
        >
          {children}
        </StorefrontLayoutRenderer>
      </StorefrontCartProvider>
    </StorefrontMerchantProvider>
  );
}
