'use client';

import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import type { Product } from './types';

interface ProductGridItemLinkProps {
  product: Product;
  basePath: string;
}

export function ProductGridItemLink({
  product,
  basePath,
}: ProductGridItemLinkProps) {
  return (
    <Link
      href={asRoute(getStorefrontProductHref(product, basePath))}
      prefetch={false}
      className="absolute inset-0 z-0"
    />
  );
}
