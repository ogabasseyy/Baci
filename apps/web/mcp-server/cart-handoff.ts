import type { SupabaseClient } from '@supabase/supabase-js';

type CartHandoffResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
};

export async function prepareCartHandoff({
  supabase,
  merchantId,
  productId,
  quantity,
  formatPrice,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  quantity: number;
  formatPrice: (price: number) => string;
}): Promise<CartHandoffResult> {
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('name, slug, price, manage_stock, stock_quantity, stock, has_variants, has_condition_offers')
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .single();

  let unavailable = Boolean(productError || !product);
  if (product?.manage_stock === true) {
    let optionAvailable = product.has_condition_offers === true && Number(product.stock_quantity ?? 0) >= quantity;
    if (product.has_condition_offers === true) {
      const { data: offers, error: offersError } = await supabase
        .from('product_offers')
        .select('stock_quantity')
        .eq('merchant_id', merchantId)
        .eq('product_id', productId)
        .eq('status', 'active');
      optionAvailable ||= !offersError && Boolean(offers?.some((offer) => Number(offer.stock_quantity ?? 0) >= quantity));
    }
    if (product.has_variants === true) {
      const { data: variants, error: variantsError } = await supabase.rpc(
        'get_storefront_product_variants',
        { p_product_ids: [productId] }
      );
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
      unavailable ||= effectiveStock < quantity;
    }
  }

  if (unavailable || !product) {
    return {
      content: [{ type: 'text', text: 'This product is not currently available to add to cart.' }],
      structuredContent: { success: false },
    };
  }

  if (product.has_variants === true || product.has_condition_offers === true) {
    const productUrl = `https://ogabassey.com/products/${encodeURIComponent(product.slug || productId)}`;
    return {
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
    };
  }

  const cartUrl = `https://ogabassey.com/cart?item_id=${encodeURIComponent(productId)}&qty=${quantity}`;
  const productName = product.name;
  const price = product.price
    ? formatPrice(product.price)
    : '';

  return {
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
  };

}
