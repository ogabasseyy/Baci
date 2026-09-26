import type { SupabaseClient } from '@supabase/supabase-js';
import { getMcpOfferAvailability, getMcpProductStockSummary } from './product-stock-summary';

interface ProductDetailSource {
  id: string;
  name: string;
  slug: string | null;
  price: number;
  compare_at_price: number | null;
  images: Array<string | { url?: string }> | null;
  description: string | null;
  stock_quantity: number | null;
  manage_stock: boolean | null;
  condition: string | null;
  condition_detail: string | null;
  brand: string | null;
  category: string | null;
  has_variants: boolean | null;
  has_condition_offers: boolean | null;
  schema_markup: { aggregateRating?: { ratingValue?: number; reviewCount?: number } } | null;
}

type ProductDetailResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export async function buildMcpProductDetail({
  product,
  supabase,
  formatPrice,
  getSafeCatalogImageUrl,
}: {
  product: ProductDetailSource;
  supabase: SupabaseClient;
  formatPrice: (price: number) => string;
  getSafeCatalogImageUrl: (imageUrl: string | null | undefined) => string | undefined;
}): Promise<ProductDetailResult> {
  // Fetch variants if product has variants
  let variants: Array<{
    attributes: Record<string, string>;
    price_override: number | null;
    stock_quantity: number;
    condition: string;
    images: unknown[];
  }> = [];
  if (product.has_variants) {
    const { data: variantData, error: variantError } = await supabase.rpc(
      'get_storefront_product_variants',
      { p_product_ids: [product.id] }
    );
    if (variantError) {
      console.error('Failed to fetch public product variants:', variantError);
      return { content: [{ type: 'text', text: 'Product variants are temporarily unavailable.' }] };
    }
    variants = variantData || [];
  }

  // Fetch condition offers if available
  let conditionOffers: Array<{
    condition: string;
    price: number;
    stock_quantity: number;
    grade: string | null;
    condition_notes: string | null;
  }> = [];
  if (product.has_condition_offers) {
    const { data: offerData, error: offerError } = await supabase.rpc('get_product_offers', {
      p_product_id: product.id,
    });
    if (offerError) {
      console.error('Failed to fetch public product offers:', offerError);
      return { content: [{ type: 'text', text: 'Product offers are temporarily unavailable.' }] };
    }
    conditionOffers = offerData || [];
  }

  // Get rating from schema_markup if available
  const rating = product.schema_markup?.aggregateRating?.ratingValue;
  const reviewCount = product.schema_markup?.aggregateRating?.reviewCount;

  const stockSummary = getMcpProductStockSummary(
    product,
    product.has_variants ? variants : undefined,
    product.has_condition_offers ? conditionOffers : undefined
  );
  const formatted = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: product.price,
    compare_at_price: product.compare_at_price,
    image: getSafeCatalogImageUrl(typeof product.images?.[0] === 'string' ? product.images[0] : product.images?.[0]?.url) ?? null,
    condition: product.condition || 'new',
    condition_detail: product.condition_detail,
    brand: product.brand,
    category: product.category,
    in_stock: stockSummary.inStock,
    stock_confidence: stockSummary.confidence,
    stock_level: stockSummary.level,
    has_variants: product.has_variants,
  };

  // Build detailed text response
  let text = `**${product.name}**\n\n`;
  text += `**Price:** ${formatPrice(product.price)}`;
  if (
    product.compare_at_price &&
    product.compare_at_price > product.price
  ) {
    const discount = Math.round(
      (1 - product.price / product.compare_at_price) * 100
    );
    text += ` ~~${formatPrice(product.compare_at_price)}~~ (${discount}% off)`;
  }
  text += '\n';

  // Condition info
  if (product.condition && product.condition !== 'new') {
    text += `**Condition:** ${product.condition}${product.condition_detail ? ` - ${product.condition_detail}` : ''}\n`;
  }

  // Brand & Category
  if (product.brand) text += `**Brand:** ${product.brand}\n`;
  if (product.category) text += `**Category:** ${product.category}\n`;

  // Rating
  if (rating) {
    text += `**Rating:** ${rating}/5${reviewCount ? ` (${reviewCount} reviews)` : ''}\n`;
  }

  // Description
  if (product.description) {
    text += `\n${product.description}\n`;
  }

  // Variants summary
  if (variants.length > 0) {
    const colors = [
      ...new Set(variants.map((v) => v.attributes?.color).filter(Boolean)),
    ];
    const storageOptions = [
      ...new Set(
        variants.map((v) => v.attributes?.storage).filter(Boolean)
      ),
    ];
    if (colors.length > 0)
      text += `\n**Available Colors:** ${colors.join(', ')}`;
    if (storageOptions.length > 0)
      text += `\n**Storage Options:** ${storageOptions.join(', ')}`;
  }

  // Condition offers summary
  if (conditionOffers.length > 0) {
    text += '\n\n**Available Conditions:**\n';
    for (const offer of conditionOffers) {
      text += `• ${offer.condition}${offer.grade ? ` (Grade ${offer.grade})` : ''}: ${formatPrice(offer.price)}`;
      text += ` - ${getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).label}`;
      text += '\n';
    }
  }

  // Stock & Link
  text += `\n**Availability:** ${formatted.in_stock === true ? 'In Stock' : formatted.in_stock === false ? 'Out of Stock' : 'Confirm at checkout'}`;
  const productPageUrl = `https://ogabassey.com/products/${encodeURIComponent(product.slug || product.id)}`;
  text += `\n\n🔗 [View Product](${productPageUrl})`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      products: [formatted],
      variants: variants.map((v) => ({
        attributes: v.attributes,
        price: v.price_override,
        stock: product.manage_stock ? v.stock_quantity : null,
        availability: getMcpOfferAvailability(product.manage_stock, v.stock_quantity).availability,
        condition: v.condition,
      })),
      condition_offers: conditionOffers.map((offer) => ({
        ...offer,
        stock_quantity: product.manage_stock ? offer.stock_quantity : null,
        availability: getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).availability,
      })),
    },
    _meta: {
      'openai/outputTemplate': 'ui://widget/store.html',
      'openai/widgetPrefersBorder': true,
    },
  };
}
