import { getMcpProductStockSummary } from './product-stock-summary';

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

/** Scans a bounded catalog window while checking stock on selected options. */
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

  let offset = 0;
  let products = await fetchPage(offset, 32) ?? [];
  while (products.length > 0 && matched.length < 4) {
    const candidates = fallback.length < 4 ? products : products.filter(matchesUseCase);
    const trackedOptions = candidates.filter((product) =>
      product.manage_stock === true && (product.has_variants || product.has_condition_offers)
    );
    const variantIds = trackedOptions.filter((product) => product.has_variants).map((product) => product.id);
    const offerIds = trackedOptions.filter((product) => product.has_condition_offers).map((product) => product.id);
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
      if (budget !== undefined && product.manage_stock === true &&
        (product.has_variants || product.has_condition_offers)) {
        const affordableVariantPrices = product.has_variants && variants !== null
          ? productVariants
            .filter((variant) => Number(variant.stock_quantity ?? 0) > 0)
            .map((variant) => Number(variant.price_override ?? product.price))
            .filter((price) => Number.isFinite(price) && price <= budget)
          : [];
        const affordableOfferPrices = product.has_condition_offers && offers !== null
          ? productOffers
            .filter((offer) => Number(offer.stock_quantity ?? 0) > 0)
            .map((offer) => Number(offer.price))
            .filter((price) => Number.isFinite(price) && price <= budget)
          : [];
        const affordablePrices = [...affordableVariantPrices, ...affordableOfferPrices];
        if (affordablePrices.length === 0) continue;
        recommendationPrice = affordablePrices.reduce((lowest, price) => Math.min(lowest, price));
      } else if (budget !== undefined && Number(product.price) > budget) {
        continue;
      }

      const recommendation = recommendationPrice === undefined
        ? product
        : { ...product, recommendationPrice };
      if (fallback.length < 4) fallback.push(recommendation);
      if (matchesUseCase(product) && matched.length < 4) matched.push(recommendation);
    }
    if (products.length < 32 || offset >= 96) break;
    offset += 32;
    products = await fetchPage(offset, 32) ?? [];
  }

  return matched.length > 0 ? matched : fallback;
}
