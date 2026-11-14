import {
  type AvailableFilterOptions,
  buildAvailableFilterOptions,
  filterCategoryProducts,
  INITIAL_CATEGORY_FILTER_STATE,
} from '@/components/storefront/ogabassey/pages/category-page-derivations';
import type { getBlackFridayProducts } from '@/lib/ogabassey-black-friday';

type Product = Awaited<ReturnType<typeof getBlackFridayProducts>>[number];

function readPrice(value: string | string[] | undefined) {
  const price = typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function getBlackFridayLineupView(
  products: Product[],
  query: Record<string, string | string[] | undefined>
) {
  const availableOptions = buildAvailableFilterOptions(products, true);
  const filters = {
    ...INITIAL_CATEGORY_FILTER_STATE,
    minPrice: readPrice(query.minPrice),
    maxPrice: readPrice(query.maxPrice),
  };
  for (const facet of Object.keys(
    availableOptions
  ) as (keyof AvailableFilterOptions)[]) {
    const value = query[facet];
    const requested = typeof value === 'string' ? [value] : (value ?? []);
    filters[facet] = availableOptions[facet].filter((option) =>
      requested.includes(option)
    );
  }
  const sort =
    query.sort === 'price-asc' || query.sort === 'price-desc' ? query.sort : '';
  const visible = filterCategoryProducts(
    products.map((product) => ({ ...product, rawPrice: product.priceAmount })),
    filters,
    true
  );
  if (sort) {
    const direction = sort === 'price-asc' ? 1 : -1;
    visible.sort((a, b) => direction * (a.priceAmount - b.priceAmount));
  }
  return { availableOptions, filters, sort, products: visible };
}
