import type { SupabaseClient } from '@supabase/supabase-js';
import { getMcpOfferAvailability } from './product-offer-availability';

/** Returns public variant and condition-offer choices for one active product. */
export async function loadMcpProductVariants({
  args,
  merchantId,
  supabase,
  sanitizeString,
  formatPrice,
}: {
  args: { product_id?: string; product_name?: string };
  merchantId: string;
  supabase: SupabaseClient;
  sanitizeString: (value: string, maxLength: number) => string;
  formatPrice: (price: number) => string;
}) {
  const sanitizedProductId = args.product_id
    ? sanitizeString(args.product_id, 80)
    : '';
  const sanitizedName = args.product_name
    ? sanitizeString(args.product_name, 100)
    : '';
  const lookupLabel = sanitizedProductId || sanitizedName;

  if (!lookupLabel) {
    return {
      content: [
        {
          type: 'text',
          text: 'Please provide a valid product ID or product name.',
        },
      ],
    };
  }

  // First find the product
  let productQuery = supabase
    .from('products')
    .select('id, name, has_variants, has_condition_offers, manage_stock')
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  productQuery = sanitizedProductId
    ? productQuery.eq('id', sanitizedProductId)
    : productQuery.ilike('name', `%${sanitizedName}%`);

  const { data: product, error: productError } = await productQuery
    .limit(1)
    .single();

  if (productError || !product) {
    if (productError && productError.code !== 'PGRST116') {
      console.error(
        JSON.stringify({
          type: 'error',
          context: 'get_product_variants',
          message: productError.message,
        })
      );
    }
    return {
      content: [
        { type: 'text', text: `Product "${lookupLabel}" not found.` },
      ],
    };
  }

  let variants: Array<{
    attributes: Record<string, string> | null;
    price_override: number | null;
    stock_quantity: number;
  }> = [];
  let variantLookupFailed = false;
  if (product.has_variants) {
    const { data, error } = await supabase.rpc(
      'get_storefront_product_variants',
      { p_product_ids: [product.id] }
    );
    if (error) {
      console.error('Failed to fetch public product variants:', error);
      if (!product.has_condition_offers) {
        return { content: [{ type: 'text', text: 'Product variants are temporarily unavailable.' }] };
      }
      variantLookupFailed = true;
    } else {
      variants = data || [];
    }
  }

  let offers: Array<{
    condition: string;
    grade: string | null;
    price: number;
    stock_quantity: number;
    condition_notes: string | null;
  }> = [];
  let offerLookupFailed = false;
  if (product.has_condition_offers) {
    const { data, error } = await supabase.rpc('get_product_offers', {
      p_product_id: product.id,
    });
    if (error) {
      console.error('Failed to fetch public product offers:', error);
      if (!product.has_variants) {
        return { content: [{ type: 'text', text: 'Product offers are temporarily unavailable.' }] };
      }
      offerLookupFailed = true;
    } else {
      offers = data || [];
    }
  }

  if (
    (!variants || variants.length === 0) &&
    (!offers || offers.length === 0)
  ) {
    if (variantLookupFailed || offerLookupFailed) {
      return { content: [{ type: 'text', text: 'Product options are temporarily unavailable.' }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: `No variants available for "${product.name}".`,
        },
      ],
    };
  }

  let text = `**Variants for ${product.name}:**\n\n`;
  if (variantLookupFailed) text += 'Variant options are temporarily unavailable.\n';
  if (offerLookupFailed) text += 'Condition offers are temporarily unavailable.\n';

  if (variants && variants.length > 0) {
    const displayVariants = product.manage_stock
      ? variants.filter((variant) => Number(variant.stock_quantity ?? 0) > 0)
      : variants;
    // Group by attribute type
    const colors = [
      ...new Set(displayVariants.map((v) => v.attributes?.color).filter(Boolean)),
    ];
    const storages = [
      ...new Set(
        displayVariants.map((v) => v.attributes?.storage).filter(Boolean)
      ),
    ];
    const sizes = [
      ...new Set(displayVariants.map((v) => v.attributes?.size).filter(Boolean)),
    ];

    if (colors.length > 0) text += `**Colors:** ${colors.join(', ')}\n`;
    if (storages.length > 0)
      text += `**Storage:** ${storages.join(', ')}\n`;
    if (sizes.length > 0) text += `**Sizes:** ${sizes.join(', ')}\n`;

    text += displayVariants.length > 0
      ? '\n**Available Combinations:**\n'
      : '\nNo available combinations.\n';
    for (const v of displayVariants.slice(0, 10)) {
      const attrs = Object.entries(v.attributes || {})
        .map(([k, val]) => `${k}: ${val}`)
        .join(', ');
      const price = v.price_override
        ? formatPrice(v.price_override)
        : 'Base price';
      const stock = !product.manage_stock
        ? 'Confirm availability with Ogabassey'
        : v.stock_quantity > 0
          ? 'In Stock'
          : 'Out of Stock';
      text += `• ${attrs} - ${price} (${stock})\n`;
    }
  }

  if (offers && offers.length > 0) {
    text += '\n**Condition Options:**\n';
    for (const o of offers) {
      const grade = o.grade ? ` (Grade ${o.grade})` : '';
      const stock = getMcpOfferAvailability(product.manage_stock, o.stock_quantity).label;
      text += `• ${o.condition}${grade}: ${formatPrice(o.price)} - ${stock}\n`;
      if (o.condition_notes) text += `  Note: ${o.condition_notes}\n`;
    }
  }

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      product_name: product.name,
      variants: (variants || []).map((variant) => ({
        ...variant,
        stock_quantity: product.manage_stock ? variant.stock_quantity : null,
        availability: !product.manage_stock
          ? 'unconfirmed'
          : variant.stock_quantity > 0
            ? 'in_stock'
            : 'out_of_stock',
      })),
      condition_offers: (offers || []).map((offer) => ({
        ...offer,
        stock_quantity: product.manage_stock ? offer.stock_quantity : null,
        availability: getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).availability,
      })),
      variant_lookup_failed: variantLookupFailed,
      offer_lookup_failed: offerLookupFailed,
    },
  };
}
