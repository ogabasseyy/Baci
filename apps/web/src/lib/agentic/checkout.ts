// --- Interfaces based on Spec ---
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { orderConditionPrice } from '@/lib/checkout/order-condition-prices';
import { getEffectiveStock } from '@/lib/product-stock';
import { coerceStorefrontManageStock } from '@/lib/storefront-agent-availability';
import { loadCheckoutCatalog } from './checkout-catalog';
import {
  conditionLaneKey,
  loadConditionPricesIsolated,
} from './checkout-condition-prices';
import { buildCheckoutFulfillment } from './checkout-fulfillment';

export interface GPTLineItem {
  id: string; // "line_item_123"
  item: {
    id: string; // product_id or variant_id
    product_id: string;
    variant_id?: string;
    variant_attributes?: Record<string, string>;
    condition?: 'new' | 'used' | 'open_box' | 'refurbished';
    quantity: number;
    title?: string;
    description?: string;
  };
  base_amount: number; // In smallest currency unit (e.g. kobo/cents) or standard?
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface GPTTotal {
  type:
    | 'items_base_amount'
    | 'items_discount'
    | 'subtotal'
    | 'discount'
    | 'fulfillment'
    | 'tax'
    | 'fee'
    | 'total';
  display_text: string;
  amount: number | string; // Spec example shows number mostly, but one "0.30" string?
  // Spec example: "amount": 300. "amount": "0.30". It seems mixed. We'll verify strictness later.
}

export interface GPTFulfillmentOption {
  type: 'shipping' | 'digital' | 'pickup';
  id: string;
  title: string;
  subtitle?: string;
  carrier?: string;
  earliest_delivery_time?: string;
  latest_delivery_time?: string;
  subtotal: number; // Cost of shipping
  tax: number;
  total: number;
}

export interface GPTMessage {
  type: 'info' | 'error';
  code?: string;
  path?: string;
  content_type: 'plain' | 'markdown';
  content: string;
}

export interface CheckoutItem {
  id: string;
  quantity: number;
  /** Full UCP lane identity, persisted so a migrated cart can be recovered. */
  variant_id?: string;
  condition?: string;
  variant_attributes?: Record<string, string>;
}

// --- Helpers ---

export async function calculateCheckoutSession(
  supabase: SupabaseClient,
  items: CheckoutItem[],
  fulfillmentOptionId: string | null | undefined,
  _currency: string,
  merchantId: string
) {
  const { products: foundProducts, variants: foundVariants } =
    await loadCheckoutCatalog(supabase, items, merchantId);

  // Condition offers are product-level lanes (no variant): resolve
  // their prices up front so a lane request is never silently quoted
  // as the generic product, with per-line availability isolation.
  const { prices: conditionPrices, unavailable: conditionUnavailable } =
    await loadConditionPricesIsolated(
      supabase,
      merchantId,
      items.map((item) => ({
        condition: item.condition === 'new' ? undefined : item.condition,
        product_id: item.id,
        variant_id: item.variant_id,
      }))
    );

  const lineItems: GPTLineItem[] = [];
  const messages: GPTMessage[] = [];

  let itemsBaseAmount = 0;
  let _shippingWeightTotal = 0; // In kg presumably

  for (const [index, requestedItem] of items.entries()) {
    const product = foundProducts.find((p) => p.id === requestedItem.id);
    // An explicit variant lane must resolve to a variant of this product;
    // otherwise the request would silently price as the generic parent.
    const laneVariant = requestedItem.variant_id
      ? foundVariants.find(
          (v) =>
            v.id === requestedItem.variant_id &&
            v.product_id === requestedItem.id
        )
      : undefined;
    if (requestedItem.variant_id && !laneVariant) {
      messages.push({
        type: 'error',
        code: 'invalid',
        path: `$.items[${index}]`,
        content_type: 'plain',
        content: `Variant ${requestedItem.variant_id} not found for item ${requestedItem.id}.`,
      });
      continue;
    }
    const variant =
      laneVariant ?? foundVariants.find((v) => v.id === requestedItem.id);

    let price = 0;
    let title = '';
    let stock: number | null = 0;
    let weight = 0;
    let productId = requestedItem.id;
    let variantAttributes: Record<string, string> | undefined;
    let variantId: string | undefined;

    if (variant) {
      // It's a variant
      productId = variant.product_id;
      variantId = variant.id;
      variantAttributes =
        requestedItem.variant_attributes ?? variant.attributes;
      const variantPrice = variant.price_override ?? variant.product?.price;
      if (variantPrice == null || !Number.isFinite(Number(variantPrice))) {
        messages.push({
          type: 'error',
          code: 'missing_price',
          path: `$.items[${index}]`,
          content: `Variant ${variant.id} is missing a valid price.`,
          content_type: 'plain',
        });
        continue;
      }
      price = Number(variantPrice);
      title = `${variant.product?.name || 'Item'} - ${Object.values(variant.attributes || {}).join('/')}`;
      stock = coerceStorefrontManageStock(variant.product?.manage_stock)
        ? (variant.stock_quantity ?? 0)
        : null;
      // Variant weight? Assume parent weight (complex logic, skip for MVP)
    } else if (product) {
      // It's a parent; option-only lanes keep their requested options.
      price = product.price;
      title = product.name;
      variantAttributes = requestedItem.variant_attributes;
      stock = coerceStorefrontManageStock(product.manage_stock)
        ? getEffectiveStock(product)
        : null;
      weight = product.weight_unit === 'kg' ? product.weight_value || 0 : 0; // Simplified
      _shippingWeightTotal += weight * requestedItem.quantity;
    } else {
      // Not found
      messages.push({
        type: 'error',
        code: 'invalid',
        path: `$.items[${items.indexOf(requestedItem)}]`,
        content_type: 'plain',
        content: `Item ${requestedItem.id} not found.`,
      });
      continue;
    }

    // Product-level condition lanes price from the active condition
    // offer, never from the generic product price.
    if (
      !requestedItem.variant_id &&
      !variantId &&
      requestedItem.condition &&
      requestedItem.condition !== 'new'
    ) {
      const conditionPrice = orderConditionPrice(conditionPrices, {
        condition: requestedItem.condition,
        product_id: productId,
        variant_id: variantId,
      });
      if (
        conditionUnavailable.has(
          conditionLaneKey(productId, requestedItem.condition)
        ) ||
        conditionPrice === undefined
      ) {
        messages.push({
          type: 'error',
          code: 'invalid',
          path: `$.items[${index}]`,
          content_type: 'plain',
          content: `Condition ${requestedItem.condition} is unavailable for item ${requestedItem.id}.`,
        });
        continue;
      }
      price = conditionPrice;
    }

    // Check Stock
    if (stock !== null && stock < requestedItem.quantity) {
      messages.push({
        type: 'error',
        code: 'out_of_stock',
        path: `$.items[${items.indexOf(requestedItem)}]`,
        content_type: 'plain',
        content: `Only ${stock} items available for ${title}.`,
      });
    }

    const itemTotal = price * requestedItem.quantity;
    itemsBaseAmount += itemTotal;

    lineItems.push({
      // Distinct per lane: sibling variants/conditions/options of one
      // product must not share a line id in the response.
      id: `line_${productId}_${variantId ?? 'base'}_${
        requestedItem.condition ?? 'new'
      }_${createHash('sha256')
        .update(JSON.stringify(variantAttributes ?? {}))
        .digest('hex')
        .slice(0, 8)}`,
      item: {
        id: requestedItem.id,
        product_id: productId,
        ...(variantId ? { variant_id: variantId } : {}),
        ...(variantAttributes ? { variant_attributes: variantAttributes } : {}),
        ...(requestedItem.condition
          ? {
              condition: requestedItem.condition as NonNullable<
                GPTLineItem['item']['condition']
              >,
            }
          : {}),
        quantity: requestedItem.quantity,
        title,
      },
      base_amount: itemTotal,
      discount: 0,
      subtotal: itemTotal,
      tax: 0,
      total: itemTotal,
    });
  }

  const { fulfillmentOptions, selectedOptionId, totals } =
    buildCheckoutFulfillment(fulfillmentOptionId, itemsBaseAmount);

  return { lineItems, totals, fulfillmentOptions, selectedOptionId, messages };
}
