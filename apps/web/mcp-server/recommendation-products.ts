import { getMcpProductStockSummary } from './product-stock-summary';

const RECOMMENDATION_PAGE_SIZE = 32;
const DEFAULT_RECOMMENDATION_PAGE_BUDGET = 4;
const BUDGETED_RECOMMENDATION_PAGE_BUDGET = 8;

interface RecommendationCandidate {
  id: string;
  name: string;
  description: string | null;
  manage_stock: boolean | null;
  price: number;
  stock_quantity: number | null;
  has_variants: boolean | null;
  has_condition_offers: boolean | null;
}

interface OptionStock {
  product_id: string;
  stock_quantity: number | null;
  price?: number | null;
  price_override?: number | null;
}

type RecommendedProduct<T> = T & { recommendationPrice?: number };

/** Scans a bounded catalog window, with a larger finite window for option-priced budget searches. */
export async function selectRecommendedProducts<T extends RecommendationCandidate>({
  keywords,
  budget,
  fetchPage,
  fetchVariants,
  fetchOffers,
}: {
  keywords: readonly string[];
  budget?: number;
  fetchPage: (offset: number, limit: number) => Promise<T[] | null>;
  fetchVariants: (ids: string[]) => Promise<OptionStock[] | null>;
  fetchOffers: (ids: string[]) => Promise<OptionStock[] | null>;
}): Promise<RecommendedProduct<T>[]> {
  const fallback: RecommendedProduct<T>[] = [];
  const matched: RecommendedProduct<T>[] = [];
  const matchesUseCase = (product: T) => keywords.some((keyword) =>
    product.name.toLowerCase().includes(keyword) ||
    product.description?.toLowerCase().includes(keyword)
  );

  const maxPages = budget === undefined
    ? DEFAULT_RECOMMENDATION_PAGE_BUDGET
    : BUDGETED_RECOMMENDATION_PAGE_BUDGET;
  let offset = 0;
  let pagesFetched = 1;
  let products = await fetchPage(offset, RECOMMENDATION_PAGE_SIZE) ?? [];
  while (products.length > 0 && matched.length < 4) {
    const candidates = fallback.length < 4 ? products : products.filter(matchesUseCase);
    const optionsNeedingHydration = candidates.filter((product) =>
      product.has_variants || product.has_condition_offers
    );
    const variantIds = optionsNeedingHydration.filter((product) => product.has_variants).map((product) => product.id);
    const offerIds = optionsNeedingHydration.filter((product) => product.has_condition_offers).map((product) => product.id);
    const [variants, offers] = await Promise.all([
      variantIds.length > 0 ? fetchVariants(variantIds) : [],
      offerIds.length > 0 ? fetchOffers(offerIds) : [],
    ]);
    const variantsByProduct = new Map<string, OptionStock[]>();
    const offersByProduct = new Map<string, OptionStock[]>();
    for (const variant of variants ?? []) {
      variantsByProduct.set(variant.product_id, [...(variantsByProduct.get(variant.product_id) ?? []), variant]);
    }
    for (const offer of offers ?? []) {
      offersByProduct.set(offer.product_id, [...(offersByProduct.get(offer.product_id) ?? []), offer]);
    }

    for (const product of candidates) {
      const productVariants = variantsByProduct.get(product.id) ?? [];
      const productOffers = offersByProduct.get(product.id) ?? [];
      const stock = getMcpProductStockSummary(
        product,
        product.has_variants && variants !== null ? productVariants : undefined,
        product.has_condition_offers && offers !== null ? productOffers : undefined
      );
      if (stock.inStock === false) continue;

      let recommendationPrice: number | undefined;
      if (product.has_variants || product.has_condition_offers) {
        const variantPrices = product.has_variants && variants !== null
          ? productVariants
            .filter((variant) => product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0)
            .map((variant) => Number(variant.price_override ?? product.price))
            .filter(Number.isFinite)
          : [];
        const offerPrices = product.has_condition_offers && offers !== null
          ? productOffers
            .filter((offer) => (product.manage_stock !== true || Number(offer.stock_quantity ?? 0) > 0) && offer.price != null)
            .map((offer) => Number(offer.price))
            .filter(Number.isFinite)
          : [];
        const baseOfferPrices = !product.has_variants &&
          product.has_condition_offers &&
          (product.manage_stock !== true || Number(product.stock_quantity ?? 0) > 0) &&
          Number.isFinite(Number(product.price))
          ? [Number(product.price)]
          : [];
        const optionPrices = [...variantPrices, ...offerPrices, ...baseOfferPrices];
        const recommendationPrices = budget === undefined
          ? optionPrices
          : optionPrices.filter((price) => price <= budget);
        if (budget !== undefined && recommendationPrices.length === 0) continue;
        if (recommendationPrices.length > 0) {
          recommendationPrice = recommendationPrices.reduce((lowest, price) => Math.min(lowest, price));
        }
      } else if (budget !== undefined && Number(product.price) > budget) {
        continue;
      }

      const recommendation = recommendationPrice === undefined
        ? product
        : { ...product, recommendationPrice };
      if (fallback.length < 4) fallback.push(recommendation);
      if (matchesUseCase(product) && matched.length < 4) matched.push(recommendation);
    }
    if (products.length < RECOMMENDATION_PAGE_SIZE || pagesFetched >= maxPages) break;
    offset += RECOMMENDATION_PAGE_SIZE;
    pagesFetched += 1;
    products = await fetchPage(offset, RECOMMENDATION_PAGE_SIZE) ?? [];
  }

  return matched.length > 0 ? matched : fallback;
}
