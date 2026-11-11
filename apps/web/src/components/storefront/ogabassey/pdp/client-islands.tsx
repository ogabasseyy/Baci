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
      {/* A missing numeric price would report a zero-value view; skip it. */}
      {typeof product.rawPrice === 'number' ? (
        <OgabasseyPdpProductViewTracker
          productId={String(product.id)}
          name={product.name}
          price={product.rawPrice}
          category={product.categories?.name || product.category || undefined}
        />
      ) : null}
      <OgabasseyPdpDeferredDetailIsland
        product={product}
        semanticSections={semanticSections}
        serverPrimaryDetails={serverPrimaryDetails}
        storeSlug={storeSlug}
      />
    </>
  );
}
