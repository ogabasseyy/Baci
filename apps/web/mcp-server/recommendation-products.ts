import { getMcpProductStockSummary } from './product-stock-summary';

interface RecommendationCandidate {
  id: string;
  name: string;
  description: string | null;
  manage_stock: boolean | null;
  stock_quantity: number | null;
  has_variants: boolean | null;
  has_condition_offers: boolean | null;
}

interface OptionStock {
  product_id: string;
  stock_quantity: number | null;
}

/** Scans a bounded catalog window while checking stock on selected options. */
export async function selectRecommendedProducts<T extends RecommendationCandidate>({
  keywords,
  fetchPage,
  fetchVariants,
  fetchOffers,
}: {
  keywords: readonly string[];
  fetchPage: (offset: number, limit: number) => Promise<T[] | null>;
  fetchVariants: (ids: string[]) => Promise<OptionStock[] | null>;
  fetchOffers: (ids: string[]) => Promise<OptionStock[] | null>;
}): Promise<T[]> {
  const fallback: T[] = [];
  const matched: T[] = [];
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
      const stock = getMcpProductStockSummary(
        product,
        product.has_variants && variants !== null ? variantsByProduct.get(product.id) ?? [] : undefined,
        product.has_condition_offers && offers !== null ? offersByProduct.get(product.id) ?? [] : undefined
      );
      if (stock.inStock === false) continue;
      if (fallback.length < 4) fallback.push(product);
      if (matchesUseCase(product) && matched.length < 4) matched.push(product);
    }
    if (products.length < 32 || offset >= 96) break;
    offset += 32;
    products = await fetchPage(offset, 32) ?? [];
  }

  return matched.length > 0 ? matched : fallback;
}
