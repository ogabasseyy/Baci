import type { Route } from 'next';
import { getProductUrl } from '@/lib/seo-utils';

interface StorefrontProductHrefInput {
  id: string | number;
  name: string;
  slug?: string;
  category?: string | null;
  categories?: { name?: string; slug?: string } | null;
  category_slug?: string;
  categorySlug?: string;
  canonical_url?: string | null;
  condition?: 'new' | 'used' | string;
  condition_detail?: string;
}

export function getStorefrontProductHref(
  product: StorefrontProductHrefInput,
  basePath = '',
  // Lab-only query preservation (?arm=...): production callers omit it
  // and get byte-identical hrefs.
  suffix = ''
): Route {
  const normalizedBasePath =
    basePath === '/' ? '' : basePath.replace(/\/+$/, '');

  return `${normalizedBasePath}${getProductUrl({
    ...product,
    id: String(product.id),
  })}${suffix}` as Route;
}
