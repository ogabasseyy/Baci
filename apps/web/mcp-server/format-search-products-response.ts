import { resolveMcpSearchProductCondition } from './product-condition-filter';
import { STORE_WIDGET_URI } from './widget-resource-uri';
import type { discoverMcpProducts } from './discover-products';

type DiscoveryResult = Awaited<ReturnType<typeof discoverMcpProducts>>;
type SelectedProduct = DiscoveryResult['selectedProducts'][number];

/** Formats successful and empty search results for both MCP response surfaces. */
export function formatSearchProductsResponse({
  selectedProducts,
  sanitizedQuery,
  coverage,
  searchMode,
  semanticUnavailable,
  requestedCondition,
  getSafeCatalogImageUrl,
}: {
  selectedProducts: SelectedProduct[];
  sanitizedQuery: string | undefined;
  coverage: 'complete' | 'partial' | undefined;
  searchMode: 'structured';
  semanticUnavailable: boolean | undefined;
  requestedCondition: string | undefined;
  getSafeCatalogImageUrl: (imageUrl: string | null | undefined) => string | undefined;
}) {
  const formatted = selectedProducts.map(({
    product: p,
    displayPrice,
    displayCondition,
    displayCompareAtPrice,
    stockSummary,
    availableVariants: variants,
    ...selection
  }) => {
    const isDiscounted = typeof displayPrice === 'number' &&
      displayCompareAtPrice && displayCompareAtPrice > displayPrice;

    const variantOptions: Record<string, Set<string>> = {};
    variants.forEach((variant) => {
      Object.entries(variant.attributes || {}).forEach(([key, value]) => {
        if (!variantOptions[key]) variantOptions[key] = new Set();
        variantOptions[key].add(String(value));
      });
    });
    const availableOptions = Object.entries(variantOptions)
      .map(([key, values]) => `${key}: ${Array.from(values).join(', ')}`)
      .join(' | ');

    const firstImage: unknown = Array.isArray(p.images) ? p.images[0] : undefined;
    const imageInput = typeof firstImage === 'string' ? firstImage :
      firstImage && typeof firstImage === 'object' && 'url' in firstImage && typeof firstImage.url === 'string'
        ? firstImage.url : undefined;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: displayPrice,
      compare_at_price: displayCompareAtPrice,
      image: getSafeCatalogImageUrl(imageInput),
      condition: displayCondition || resolveMcpSearchProductCondition(p, requestedCondition),
      brand: p.brand,
      category: p.category,
      in_stock: stockSummary.inStock,
      stock_level: stockSummary.level,
      stock_confidence: stockSummary.confidence,
      price_status: isDiscounted ? 'discounted' : 'regular',
      matched_option: 'selectedOption' in selection ? selection.selectedOption : undefined,
      available_variants: availableOptions || 'Standard',
      last_updated: p.updated_at,
    };
  });

  const count = formatted.length;
  if (count === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: [`No clear catalog match for "${sanitizedQuery || 'your criteria'}". Specify a product type, brand, or model and try again.`,
          ...(coverage === 'partial' ? ['This is a partial selection; other products may match.'] : []),
        ].join('\n'),
      }],
      structuredContent: { products: [], status: 'empty', coverage },
    };
  }

  const resultText = [
    `Found ${count} Ogabassey products. Prices are listed in NGN; confirm availability before checkout.`,
    ...(coverage === 'partial' ? ['This is a partial selection; other products may match.'] : []),
    ...formatted.map((product) =>
      `${product.name} — ₦${Number(product.price).toLocaleString('en-NG')} (${product.stock_level}); ${product.available_variants}.`
    ),
  ].join('\n');

  return {
    content: [{ type: 'text' as const, text: resultText }],
    structuredContent: {
      status: 'success',
      products: formatted,
      coverage,
      search_mode: searchMode,
      semantic_unavailable: semanticUnavailable,
      meta: { total: count, query: sanitizedQuery },
    },
    _meta: {
      'openai/outputTemplate': STORE_WIDGET_URI,
      'openai/widgetPrefersBorder': true,
    },
  };
}
