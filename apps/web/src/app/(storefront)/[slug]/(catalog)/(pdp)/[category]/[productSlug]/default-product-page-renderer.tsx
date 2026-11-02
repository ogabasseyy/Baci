import '@/app/(storefront)/storefront-pdp.css';
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
