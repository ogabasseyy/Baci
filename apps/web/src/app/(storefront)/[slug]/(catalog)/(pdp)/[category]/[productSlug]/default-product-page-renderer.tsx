import '@/app/(storefront)/storefront-pdp.css';
import '@/app/(storefront)/storefront-pdp-semantic.css';
import type { ReactNode } from 'react';
import type { Product } from '@/lib/products';
import { DefaultProductDetailClient } from './default-product-detail-client';

interface DefaultProductPageRendererProps {
  product: Product;
  semanticSections: ReactNode;
}

export function DefaultProductPageRenderer({
  product,
  semanticSections,
}: DefaultProductPageRendererProps) {
  return (
    <>
      <DefaultProductDetailClient product={product} />
      {semanticSections}
    </>
  );
}
