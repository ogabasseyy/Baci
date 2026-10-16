// --- Interfaces based on Spec ---
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveStock } from '@/lib/product-stock';
import { coerceStorefrontManageStock } from '@/lib/storefront-agent-availability';

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

interface AgenticProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  stock_quantity?: number;
  manage_stock?: boolean | null;
  weight_value?: number;
  weight_unit?: string;
}

interface AgenticVariant {
  id: string;
  merchant_id: string;
  product_id: string;
  price_override?: number;
  stock_quantity: number;
  attributes?: Record<string, string>;
  product?: {
    manage_stock?: boolean | null;
    name: string;
    price?: number;
    weight_unit?: string;
    weight_value?: number;
  };
}

// --- Helpers ---

const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function calculateCheckoutSession(
  supabase: SupabaseClient,
  items: CheckoutItem[],
  fulfillmentOptionId: string | null | undefined,
  _currency: string,
  merchantId: string
) {
  // 1. Fetch products
  // We need to handle both Product IDs and Variant IDs.
  // Our new setup uses `id` for both (variants have unique UUIDs usually, or SKU).
  // Ideally we query `products` and `product_variants`.

  // Product and variant IDs are Postgres UUIDs. External IDs are left to the
  // per-item validation path below instead of being sent through UUID filters.
  const productIds = items.map((i) => i.id);
  const lookupProductIds = Array.from(
    new Set(productIds.filter((id) => POSTGRES_UUID_PATTERN.test(id)))
  );

  let foundProducts: AgenticProduct[] = [];
  let foundVariants: AgenticVariant[] = [];

  if (lookupProductIds.length > 0) {
    // Try fetching from products first (parents)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select(
        'id, name, price, stock, stock_quantity, manage_stock, weight_value, weight_unit'
      )
      .in('id', lookupProductIds)
      .eq('merchant_id', merchantId)
      .returns<AgenticProduct[]>();
    if (productsError) {
      throw new Error('Failed to load checkout products');
    }

    // Try fetching from variants
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select(
        'id, merchant_id, product_id, price_override, stock_quantity, attributes, product:products!product_variants_product_id_fkey(name, price, manage_stock, weight_value, weight_unit)'
      )
      .in('id', lookupProductIds)
      .eq('merchant_id', merchantId)
      .returns<AgenticVariant[]>();
    if (variantsError) {
      throw new Error('Failed to load checkout product variants');
    }

    foundProducts = products || [];
    foundVariants = variants || [];
  }

  const lineItems: GPTLineItem[] = [];
  const messages: GPTMessage[] = [];

  let itemsBaseAmount = 0;
  let _shippingWeightTotal = 0; // In kg presumably

  for (const [index, requestedItem] of items.entries()) {
    const product = foundProducts.find((p) => p.id === requestedItem.id);
    const variant = foundVariants.find((v) => v.id === requestedItem.id);

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
      variantAttributes = variant.attributes;
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
      // It's a parent
      price = product.price;
      title = product.name;
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
      id: `line_${requestedItem.id}`,
      item: {
        id: requestedItem.id,
        product_id: productId,
        ...(variantId ? { variant_id: variantId } : {}),
        ...(variantAttributes ? { variant_attributes: variantAttributes } : {}),
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

  // Fulfillment Options
  // Default: Pickup and Standard Shipping
  const fulfillmentOptions: GPTFulfillmentOption[] = [];

  // 1. Pickup
  fulfillmentOptions.push({
    type: 'pickup',
    id: 'pickup_store_1',
    title: 'Store Pickup',
    subtitle: 'Pick up at Ogabassey Ikeja Store',
    subtotal: 0,
    tax: 0,
    total: 0,
  });

  // 2. Standard Shipping (GIGL / Flat Rate approximation for MVP)
  // Real GIGL calc requires address. If address missing, show estimate?
  // Spec: "If no fulfillment address is provided... checkout cannot be completed."
  // But we can return options?
  // Let's return a flat rate fallback if address missing, or calc if present.
  const flatShippingRate = 2500; // NGN
  fulfillmentOptions.push({
    type: 'shipping',
    id: 'shipping_standard',
    title: 'Standard Delivery',
    subtitle: 'Delivery within Lagos',
    // carrier: 'GIGL',
    subtotal: flatShippingRate,
    tax: 0,
    total: flatShippingRate,
  });

  // Select fulfillment
  let selectedOption = fulfillmentOptions.find(
    (o) => o.id === fulfillmentOptionId
  );
  if (!selectedOption && fulfillmentOptions.length > 0) {
    selectedOption = fulfillmentOptions[0]; // Default
  }

  const fulfillmentCost = selectedOption ? selectedOption.total : 0;
  const grandTotal = itemsBaseAmount + fulfillmentCost;

  // Totals
  const totals: GPTTotal[] = [
    {
      type: 'items_base_amount',
      display_text: 'Items Subtotal',
      amount: itemsBaseAmount,
    },
    { type: 'fulfillment', display_text: 'Shipping', amount: fulfillmentCost },
    { type: 'total', display_text: 'Total Due', amount: grandTotal },
  ];

  return {
    lineItems,
    totals,
    fulfillmentOptions,
    selectedOptionId: selectedOption?.id,
    messages,
  };
}
