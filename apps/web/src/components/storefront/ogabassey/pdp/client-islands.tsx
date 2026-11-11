import type { ReactNode } from 'react';
import type { Product } from '@/components/storefront/ogabassey/types';
import { OgabasseyPdpDeferredDetailIsland } from './deferred-detail-island';
import { OgabasseyPdpProductViewTracker } from './product-view-tracker.client';

interface OgabasseyPdpBelowFoldIslandProps {
  product: Product;
  semanticSections?: ReactNode;
  serverPrimaryDetails?: ReactNode;
  storeSlug: string;
}

export function OgabasseyPdpBelowFoldIsland({
  product,
  semanticSections = null,
  serverPrimaryDetails = null,
  storeSlug,
}: OgabasseyPdpBelowFoldIslandProps) {
  return (
    <>
      <OgabasseyPdpProductViewTracker
        productId={String(product.id)}
        name={product.name}
        price={product.rawPrice ?? 0}
        category={product.categories?.name || product.category || undefined}
      />
      <OgabasseyPdpDeferredDetailIsland
        product={product}
        semanticSections={semanticSections}
        serverPrimaryDetails={serverPrimaryDetails}
        storeSlug={storeSlug}
      />
    </>
  );
}
