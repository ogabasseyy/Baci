import { generateSlug } from '@/lib/seo-utils';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export interface BrandComparisonRow {
  label: string;
  leftValue: string;
  rightValue: string;
}

export interface BrandComparisonProduct {
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  category_slug: string;
  status?: string | null;
}

function formatPriceRange(
  products: BrandComparisonProduct[],
  priceFormatter: Intl.NumberFormat
) {
  const prices = products.map((product) => product.price);
  if (prices.length === 0) {
    return '—';
  }
  return `${priceFormatter.format(Math.min(...prices))} to ${priceFormatter.format(
    Math.max(...prices)
  )}`;
}

function selectByPrice(
  products: BrandComparisonProduct[],
  direction: 'asc' | 'desc'
) {
  return (
    products
      .slice()
      .sort((left, right) =>
        direction === 'asc'
          ? left.price - right.price
          : right.price - left.price
      )[0]?.name || '—'
  );
}

function filterProductsByCanonicalBrand(
  categorySlug: string,
  products: BrandComparisonProduct[],
  brandLabel: string
): BrandComparisonProduct[] {
  const brandKey = generateSlug(brandLabel);
  return products.filter(
    (product) =>
      resolveCanonicalBrandKey(categorySlug, product.brand) === brandKey
  );
}

export function buildBrandComparisonRows(args: {
  categorySlug: string;
  leftBrand: string;
  rightBrand: string;
  products: BrandComparisonProduct[];
  priceFormatter: Intl.NumberFormat;
}): {
  leftBrandProducts: BrandComparisonProduct[];
  rightBrandProducts: BrandComparisonProduct[];
  comparisonRows: BrandComparisonRow[];
} {
  const leftBrandProducts = filterProductsByCanonicalBrand(
    args.categorySlug,
    args.products,
    args.leftBrand
  );
  const rightBrandProducts = filterProductsByCanonicalBrand(
    args.categorySlug,
    args.products,
    args.rightBrand
  );
  const comparisonRows: BrandComparisonRow[] = [
    {
      label: 'Active models',
      leftValue: String(leftBrandProducts.length),
      rightValue: String(rightBrandProducts.length),
    },
    {
      label: 'Price range',
      leftValue: formatPriceRange(leftBrandProducts, args.priceFormatter),
      rightValue: formatPriceRange(rightBrandProducts, args.priceFormatter),
    },
    {
      label: 'Cheapest model',
      leftValue: selectByPrice(leftBrandProducts, 'asc'),
      rightValue: selectByPrice(rightBrandProducts, 'asc'),
    },
    {
      label: 'Premium model',
      leftValue: selectByPrice(leftBrandProducts, 'desc'),
      rightValue: selectByPrice(rightBrandProducts, 'desc'),
    },
  ];
  return { leftBrandProducts, rightBrandProducts, comparisonRows };
}
