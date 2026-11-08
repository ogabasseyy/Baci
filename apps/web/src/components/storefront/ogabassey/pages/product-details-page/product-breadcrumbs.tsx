import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import type { NormalizedProductDetails } from './product-details-helpers';

interface ProductBreadcrumbsProps {
  basePath: string;
  homeHref: Route;
  productData: NormalizedProductDetails;
}

export function ProductBreadcrumbs({
  basePath,
  homeHref,
  productData,
}: ProductBreadcrumbsProps) {
  const categoryLabel =
    productData.categories?.name || productData.category || 'Category';
  const categorySlug =
    productData.categories?.slug ||
    productData.categorySlug ||
    encodeURIComponent(categoryLabel.toLowerCase());
  const categoryHref = asRoute(
    `${basePath}/${categorySlug}`.replace(/\/{2,}/g, '/')
  );
  const productHref = asRoute(
    `${basePath}/${categorySlug}/${productData.slug || ''}`.replace(
      /\/{2,}/g,
      '/'
    )
  );

  return (
    <nav aria-label="Breadcrumb" className="mb-8 flex items-center overflow-x-auto whitespace-nowrap pb-2 text-sm text-store-background-text/70">
      <Link
        href={homeHref}
        prefetch={false}
        className="transition-colors md:hover:text-store-primary"
      >
        Home
      </Link>
      <ChevronRight
        size={16}
        className="mx-2"
        aria-hidden="true"
        role="presentation"
      />
      <Link
        href={categoryHref}
        prefetch={false}
        className="transition-colors md:hover:text-store-primary"
      >
        {categoryLabel}
      </Link>
      <ChevronRight
        size={16}
        className="mx-2"
        aria-hidden="true"
        role="presentation"
      />
      <span
        aria-current="page"
        className="font-medium text-store-background-text"
      >
        {productData.name}
      </span>
    </nav>
  );
}
