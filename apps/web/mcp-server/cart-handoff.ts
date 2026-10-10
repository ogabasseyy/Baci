import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveStock } from '../src/lib/product-stock';
import { resolveSerializedAnchorStock } from '../src/lib/serialized-anchor-stock';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import {
  type HandoffOfferRow,
  hasSelectableStockedOffer,
} from './cart-handoff-offer-availability';
import { isVariantRowPurchasable } from './cart-handoff-variant-availability';
import {
  STOREFRONT_SNAPSHOT_OFFER_WINDOW,
  STOREFRONT_SNAPSHOT_VARIANT_WINDOW,
} from './storefront-snapshot-window';

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
    .select('name, slug, price, manage_stock, stock_quantity, stock, has_variants, has_condition_offers, condition')
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
  // Simple serialized products resolve through the anchor projection RPC,
  // mirroring search hydration: a serialized_strict anchor gates an
  // otherwise unmanaged parent on its available units, while
  // serialized_then_unlimited resolves empty anchors to the unlimited
  // sentinel instead of rejecting a purchasable line. Absence of a row
  // means no serialized policy (stored stock stands); an RPC failure keeps
  // stored stock so a lookup outage fails open exactly like search, while
  // staying transient so rejections remain retryable instead of typed as
  // permanently unavailable.
  let manageStock = product?.manage_stock;
  let stockQuantity = product?.stock_quantity;
  if (product && product.has_variants !== true) {
    // Shared with the website transfer path so chat saves and website adds
    // evaluate the same serialized policy for the same product.
    const anchors = await resolveSerializedAnchorStock({
      supabase,
      merchantId,
      productIds: [productId],
    });
    if (anchors.failed) {
      console.error(
        'Failed to fetch serialized anchor policy for cart handoff:',
        anchors.error
      );
      transient = true;
    } else {
      const projection = anchors.projections.get(productId);
      if (projection) {
        manageStock = projection.manageStock;
        stockQuantity = projection.stockQuantity;
      }
    }
  }
  if (product && manageStock === true) {
    let optionAvailable = product.has_condition_offers === true && product.has_variants !== true &&
      Number(stockQuantity ?? 0) >= quantity;
    // Variants evaluate before offers: resolvePublicProductOption gives a
    // paired variant ownership of purchasability, so for variant-bearing
    // products an offer can only combine with an already-purchasable
    // variant — a stocked offer alone would send the shopper to
    // selection that cannot be added.
    let variantAvailable = false;
    if (product.has_variants === true) {
      // The search-shaped RPC projects each variant's effective inventory
      // policy; the storefront RPC returns raw stock only, which would
      // report a purchasable serialized_then_unlimited variant at zero
      // units as unavailable instead of returning option selection.
      const { data: variants, error: variantsError } = await supabase.rpc(
        'get_mcp_search_product_variants',
        { p_product_ids: [productId], p_merchant_id: merchantId }
      );
      if (variantsError) transient = true;
      const own =
        !variantsError && Array.isArray(variants)
          ? variants.filter((variant) => variant.product_id === productId)
          : [];
      // The RPC returns a 129th sentinel row past the storefront's
      // 128-variant window, and the PDP refuses truncated products as
      // unavailable: fail closed instead of offering selection the PDP
      // cannot present.
      if (own.length > STOREFRONT_SNAPSHOT_VARIANT_WINDOW) unavailable = true;
      const parentStock = getEffectiveStock({
        stock: product.stock,
        stock_quantity: stockQuantity,
      });
      variantAvailable = own.some((variant) =>
        isVariantRowPurchasable(variant, parentStock, quantity)
      );
      optionAvailable ||= variantAvailable;
    }
    if (product.has_condition_offers === true) {
      // PDP parity: the snapshot keeps 16 offers by (condition, id), so a
      // stocked 17th offer is unpurchasable — window before the stock
      // check or selection advertises an option the PDP cannot fulfill.
      // For variant-bearing products the offer only counts when a variant
      // already passed: purchasability belongs to the paired variant.
      const { data: offers, error: offersError } = await supabase
        .from('product_offers')
        .select('condition, stock_quantity')
        .eq('merchant_id', merchantId)
        .eq('product_id', productId)
        .eq('status', 'active')
        .order('condition')
        .order('id')
        .limit(STOREFRONT_SNAPSHOT_OFFER_WINDOW);
      if (offersError) transient = true;
      optionAvailable ||=
        !offersError &&
        (product.has_variants !== true || variantAvailable) &&
        hasSelectableStockedOffer(
          offers as HandoffOfferRow[] | null,
          product.condition,
          quantity
        );
    }
    if (product.has_condition_offers === true || product.has_variants === true) {
      unavailable ||= !optionAvailable;
    } else {
      const effectiveStock = Number(stockQuantity ?? 0);
      unavailable ||= !Number.isFinite(effectiveStock) || effectiveStock < quantity;
    }
  } else if (
    product?.has_variants === true &&
    product?.has_condition_offers !== true
  ) {
    // Unmanaged parents fail open to option selection — except an empty
    // or strict-only variant set with insufficient units: no option is
    // purchasable (mirrors isPublicVariantPurchasable, which gates
    // strict variants regardless of the parent policy, and the
    // storefront cart provider, which cannot add a variant product
    // without a resolvable variant ID), so report unavailable instead
    // of sending the shopper to select options that cannot be
    // fulfilled. Products with condition offers keep failing open:
    // offers are not evaluated for unmanaged parents. (every on an
    // empty set is vacuously true, so no length guard is needed: zero
    // rows is zero purchasable options.)
    const { data: variants, error: variantsError } = await supabase.rpc(
      'get_mcp_search_product_variants',
      { p_product_ids: [productId], p_merchant_id: merchantId }
    );
    if (variantsError) transient = true;
    if (!variantsError && Array.isArray(variants)) {
      const own = variants.filter(
        (variant) => variant.product_id === productId
      );
      // Same truncation fail-closed as the managed path: the PDP
      // refuses products past the 128-variant window, so a sentinel
      // row means selection would dead-end there.
      if (own.length > STOREFRONT_SNAPSHOT_VARIANT_WINDOW) unavailable = true;
      if (
        own.every(
          (variant) =>
            variant.effective_policy === 'serialized_strict' &&
            Number(variant.stock_quantity ?? 0) < quantity
        )
      ) {
        unavailable = true;
      }
      // Legacy null parents are managed inventory: isPublicVariantPurchasable
      // gates ordinary rows on stock under a null parent instead of failing
      // open, so mirror it — otherwise zero-stock ordinary variants return
      // requires_variant_selection and send the shopper to a dead-end PDP.
      // Strictly null only: an absent (undefined) policy stays fail-open.
      if (
        manageStock === null &&
        !own.some((variant) =>
          isVariantRowPurchasable(
            variant,
            getEffectiveStock({
              stock: product.stock,
              stock_quantity: stockQuantity,
            }),
            quantity
          )
        )
      ) {
        unavailable = true;
      }
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
