import { buildCategoryHubBrandCards } from '@/lib/storefront-category/category-hub-brand-cards';
import { buildPriceBandCards } from '@/lib/storefront-category/category-hub-price-band-cards';
import type {
  BrandAuthorityEntry,
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { buildBestForCards } from './category-hub-best-for-cards';

export { buildBestForCards };

export function buildCategoryHubCards(input: {
  categorySlug: string;
  storeUrl: string;
  products: CategoryHubProduct[];
  merchantCurrency?: string | null;
  brandAuthorityEntries?: Array<
    BrandAuthorityEntry & {
      productCount: number;
      productCountIsLowerBound?: boolean;
    }
  >;
}): {
  bestForCards: CategoryHubCard[];
  brandCards: CategoryHubCard[];
  priceBandCards: CategoryHubCard[];
} {
  return {
    bestForCards: buildBestForCards({
      categorySlug: input.categorySlug,
      storeUrl: input.storeUrl,
      products: input.products,
      merchantCurrency: input.merchantCurrency,
    }),
    brandCards: buildCategoryHubBrandCards(input),
    priceBandCards: buildPriceBandCards({
      categorySlug: input.categorySlug,
      storeUrl: input.storeUrl,
      products: input.products,
      merchantCurrency: input.merchantCurrency,
    }),
  };
}
