import { z } from 'zod';

const availability = z.enum(['unconfirmed', 'in_stock', 'out_of_stock']);
const attributes = z.record(z.string(), z.unknown()).nullable();
const money = z.number().nonnegative();
const catalogColors = z.object({
  labels: z.array(z.string()),
  source: z
    .enum([
      'product.color',
      'product.color_images',
      'product.color+color_images',
    ])
    .nullable(),
  images_by_color: z.record(z.string(), z.array(z.string())),
  meaning: z.string(),
});
const product = z.object({
  id: z.string(),
  name: z.string(),
  price: money.nullable(),
  slug: z.string().nullable().optional(),
  compare_at_price: money.nullable().optional(),
  image: z.string().nullable().optional(),
  condition: z.string(),
  condition_detail: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  in_stock: z.boolean().nullable(),
  stock_level: z.string(),
  stock_confidence: z.enum(['high', 'low', 'none', 'unconfirmed']),
  has_variants: z.boolean().nullable().optional(),
});
const conditionOffer = z.looseObject({
  condition: z.string(),
  grade: z.string().nullable().optional(),
  price: money,
  stock_quantity: z.number().nonnegative().nullable(),
  availability,
  condition_notes: z.string().nullable().optional(),
});
const lookupFlags = {
  variant_lookup_failed: z.boolean().optional(),
  offer_lookup_failed: z.boolean().optional(),
};

/** Public structuredContent contracts; unknown availability is never true. */
export const mcpToolOutputSchemas = {
  search_products: z.object({
    status: z.enum(['success', 'empty', 'incomplete', 'error']),
    products: z.array(
      product.extend({
        description_excerpt: z.string().optional(),
        price_status: z.enum(['discounted', 'regular']),
        available_variants: z.string(),
        last_updated: z.string().nullable().optional(),
        url: z.string(),
        matched_option: z
          .object({
            kind: z.enum(['base', 'variant', 'offer']),
            option_id: z.string().optional(),
            variantId: z.string().optional(),
            condition: z.string(),
            price: money,
            attributes: z.record(z.string(), z.unknown()),
          })
          .optional(),
      })
    ),
    coverage: z.enum(['complete', 'partial']).optional(),
    search_mode: z.literal('structured').optional(),
    semantic_unavailable: z.boolean().optional(),
    message: z.string().optional(),
    meta: z
      .object({
        total: z.number().int().nonnegative(),
        query: z.string().optional(),
      })
      .optional(),
  }),
  prepare_storefront_cart_link: z.object({
    success: z
      .boolean()
      .describe(
        'True means a handoff URL was prepared; the cart is not mutated by this tool.'
      ),
    product_id: z.string().optional(),
    product_name: z.string().optional(),
    quantity: z.number().int().min(1).max(10).optional(),
    cart_url: z
      .string()
      .optional()
      .describe('Opening this URL adds the item on Ogabassey.'),
    requires_variant_selection: z.literal(true).optional(),
    product_url: z.string().optional(),
    message: z.string().optional(),
  }),
  get_product: z.object({
    products: z.array(product),
    status: z.enum(['not_found', 'unavailable', 'invalid_input']).optional(),
    message: z.string().optional(),
    catalog_colors: catalogColors.optional(),
    variants: z
      .array(
        z.object({
          attributes,
          price: money.nullable().optional(),
          stock: z.number().nonnegative().nullable().optional(),
          availability,
          condition: z.string().nullable().optional(),
        })
      )
      .optional(),
    condition_offers: z.array(conditionOffer).optional(),
    ...lookupFlags,
  }),
  get_product_variants: z.object({
    status: z
      .enum(['not_found', 'unavailable', 'invalid_input', 'empty'])
      .optional(),
    message: z.string().optional(),
    product_name: z.string().optional(),
    catalog_colors: catalogColors.optional(),
    variants: z.array(
      z.looseObject({
        attributes,
        price_override: money
          .nullable()
          .optional()
          .describe('Absent or null means the base product price applies.'),
        stock_quantity: z.number().nonnegative().nullable(),
        availability,
      })
    ),
    condition_offers: z.array(conditionOffer),
    ...lookupFlags,
  }),
  get_store_info: z.object({
    topic: z.enum(['contact', 'shipping', 'returns', 'payment', 'general']),
    message: z.string(),
  }),
  browse_categories: z.object({
    categories: z.array(z.string()),
    status: z.enum(['empty', 'unavailable']).optional(),
    message: z.string().optional(),
  }),
  get_brands: z.object({
    brands: z.array(z.string()),
    status: z.enum(['empty', 'unavailable']).optional(),
    message: z.string().optional(),
  }),
  get_delivery_fee_info: z
    .object({
      city: z.string().nullable(),
      fee: z.number().nonnegative().nullable(),
      policy_url: z.literal('https://ogabassey.com/shipping'),
      quote_available: z.boolean(),
      state: z.string(),
      status: z.enum([
        'quoted',
        'needs_items',
        'needs_city',
        'needs_weight',
        'needs_selection',
        'unavailable',
      ]),
      message: z.string(),
      quotes: z.array(
        z.object({
          provider: z.literal('GIGL'),
          service: z.string(),
          fee: z.number().nonnegative(),
          currency: z.literal('NGN'),
          delivery_type: z.enum(['door', 'pickup_station']),
          expires_at: z.iso.datetime(),
          station_name: z.string().nullable(),
          station_address: z.string().nullable(),
        })
      ),
    })
    .refine(
      (result) =>
        result.status === 'quoted'
          ? result.quote_available &&
            result.quotes.length > 0 &&
            (result.fee === null ||
              result.quotes.some((quote) => quote.fee === result.fee))
          : !result.quote_available &&
            result.fee === null &&
            result.quotes.length === 0,
      {
        message:
          'Delivery availability and fees must match the returned quote state',
      }
    ),
};
