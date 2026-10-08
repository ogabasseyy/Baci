import type { SupabaseClient } from '@supabase/supabase-js';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

type CartHandoffResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
};

/** Downgrades corrupt handoff payloads to a schema-valid error instead of letting SDK output validation throw. */
function guardCartHandoffResult(result: CartHandoffResult): CartHandoffResult {
  if (mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success) return result;
  return {
    content: [{ type: 'text', text: '❌ Unable to add item to cart.' }],
    structuredContent: { success: false, message: 'Unable to prepare cart link.' },
  };
}

export async function prepareCartHandoff({
  supabase,
  merchantId,
  productId: rawProductId,
  quantity,
  formatPrice,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  quantity: number;
  formatPrice: (price: number) => string;
}): Promise<CartHandoffResult> {
  // UUID text is case-insensitive, but the variants check below compares
  // exact strings against canonical lowercase RPC values: normalize
  // UUID-shaped IDs so an uppercase caller takes the same path as its
  // lowercase twin. Non-UUID legacy IDs pass through untouched.
  const productId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawProductId
    )
      ? rawProductId.toLowerCase()
      : rawProductId;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return {
      content: [{ type: 'text', text: '❌ Unable to add item to cart.' }],
      structuredContent: { success: false, message: 'Unable to prepare cart link.' },
    };
  }
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('name, slug, price, manage_stock, stock_quantity, stock, has_variants, has_condition_offers')
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .single();

  if (product && (typeof product.name !== 'string' || !product.name.trim())) {
    return {
      content: [{ type: 'text', text: '❌ Unable to add item to cart.' }],
      structuredContent: { success: false, message: 'Unable to prepare cart link.' },
    };
  }

  // A missing row arrives as PGRST116; any other query failure is
  // transient and must stay untyped so callers fail closed instead of
  // treating it as a dead product.
  let transient =
    Boolean(productError) &&
    (productError as { code?: string }).code !== 'PGRST116';
  let unavailable = Boolean(productError || !product);
  if (product?.manage_stock === true) {
    let optionAvailable = product.has_condition_offers === true && product.has_variants !== true &&
      Number(product.stock_quantity ?? 0) >= quantity;
    if (product.has_condition_offers === true) {
      const { data: offers, error: offersError } = await supabase
        .from('product_offers')
        .select('stock_quantity')
        .eq('merchant_id', merchantId)
        .eq('product_id', productId)
        .eq('status', 'active');
      if (offersError) transient = true;
      optionAvailable ||= !offersError && Boolean(offers?.some((offer) => Number(offer.stock_quantity ?? 0) >= quantity));
    }
    if (product.has_variants === true) {
      const { data: variants, error: variantsError } = await supabase.rpc(
        'get_storefront_product_variants',
        { p_product_ids: [productId] }
      );
      if (variantsError) transient = true;
      optionAvailable ||= !variantsError && Array.isArray(variants) &&
        variants.some((variant) =>
          variant.product_id === productId &&
          Number(variant.stock_quantity ?? 0) >= quantity
        );
    }
    if (product.has_condition_offers === true || product.has_variants === true) {
      unavailable ||= !optionAvailable;
    } else {
      const effectiveStock = Number(product.stock_quantity ?? 0);
      unavailable ||= !Number.isFinite(effectiveStock) || effectiveStock < quantity;
    }
  }

  if (unavailable || !product) {
    return guardCartHandoffResult({
      content: [{ type: 'text', text: 'This product is not currently available to add to cart.' }],
      structuredContent: transient
        ? { success: false }
        : { success: false, product_unavailable: true },
    });
  }

  if (product.has_variants === true || product.has_condition_offers === true) {
    const productUrl = `https://ogabassey.com/products/${encodeURIComponent(product.slug || productId)}`;
    return guardCartHandoffResult({
      content: [{
        type: 'text',
        text: `Choose the available options for **${product.name}** on Ogabassey before adding it to your cart.\n\n[Select product options](${productUrl})`,
      }],
      structuredContent: {
        success: false,
        requires_variant_selection: true,
        product_id: productId,
        product_url: productUrl,
      },
    });
  }

  if (!Number.isFinite(product.price) || product.price < 0) {
    return {
      content: [{ type: 'text', text: '❌ Unable to add item to cart.' }],
      structuredContent: { success: false, message: 'Unable to prepare cart link.' },
    };
  }

  const cartUrl = `https://ogabassey.com/cart?item_id=${encodeURIComponent(productId)}&qty=${quantity}`;
  const productName = product.name;
  const price = product.price
    ? formatPrice(product.price)
    : '';

  return guardCartHandoffResult({
    content: [
      {
        type: 'text',
        text: `To add **${productName}**${price ? ` (${price})` : ''} to your cart, open Ogabassey and verify the item and final price before checkout.\n\n[Add to cart on Ogabassey](${cartUrl})`,
      },
    ],
    structuredContent: {
      success: true,
      product_id: productId,
      product_name: productName,
      quantity,
      cart_url: cartUrl,
    },
  });

}
