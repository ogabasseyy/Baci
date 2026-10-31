import { UCP_SCHEMAS, type UcpSchemaRef } from './ucp-schema-validator';

const VERSION = '2026-04-08';

const SUCCESS_TOTALS = [
  { amount: 7996, display_text: 'Subtotal', type: 'subtotal' },
  { amount: 7996, display_text: 'Total', type: 'total' },
];

function ucpEnvelope(capability: string) {
  return {
    capabilities: { [capability]: [{ version: VERSION }] },
    status: 'success',
    version: VERSION,
  };
}

function lineItemItem(price: number | null) {
  return {
    id: 'variant_1',
    ...(price === null ? {} : { price }),
    title: 'Example phone',
  };
}

const PRODUCT = {
  description: { plain: 'An example phone' },
  id: 'product_1',
  price_range: {
    max: { amount: 3998, currency: 'NGN' },
    min: { amount: 3998, currency: 'NGN' },
  },
  title: 'Example phone',
  variants: [
    {
      availability: { available: true },
      description: { plain: 'An example phone' },
      id: 'variant_1',
      inputs: [{ id: 'product_1', match: 'featured' }],
      price: { amount: 3998, currency: 'NGN' },
      title: 'Example phone',
    },
  ],
};

const VALID_UCP_BUSINESS_PROFILE = {
  signing_keys: [],
  ucp: {
    capabilities: {
      'dev.ucp.shopping.cart': [
        {
          schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
          spec: 'https://ucp.dev/2026-04-08/specification/cart',
          version: VERSION,
        },
      ],
    },
    payment_handlers: {
      'com.example.bank_transfer': [
        {
          available_instruments: [{ type: 'bank_transfer' }],
          id: 'bank_transfer',
          spec: 'https://example.com/docs/bank-transfer',
          version: VERSION,
        },
      ],
    },
    services: {
      'dev.ucp.shopping': [
        {
          endpoint: 'https://shop.example.com/api/agentic',
          schema:
            'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
          spec: 'https://ucp.dev/2026-04-08/specification/overview',
          transport: 'rest',
          version: VERSION,
        },
      ],
    },
    version: VERSION,
  },
};

const INVALID_UCP_BUSINESS_PROFILE = {
  ...VALID_UCP_BUSINESS_PROFILE,
  ucp: {
    ...VALID_UCP_BUSINESS_PROFILE.ucp,
    payment_handlers: undefined,
    version: 'April 2026',
  },
};

const VALID_UCP_SEARCH_RESPONSE = {
  pagination: { has_next_page: false },
  products: [PRODUCT],
  ucp: ucpEnvelope('dev.ucp.shopping.catalog.search'),
};

const INVALID_UCP_SEARCH_RESPONSE = {
  ...VALID_UCP_SEARCH_RESPONSE,
  products: [
    {
      ...PRODUCT,
      price_range: {
        max: { amount: 39.98, currency: 'NGN' },
        min: { amount: 39.98, currency: 'NGN' },
      },
    },
  ],
};

const VALID_UCP_LOOKUP_RESPONSE = {
  products: [PRODUCT],
  ucp: ucpEnvelope('dev.ucp.shopping.catalog.lookup'),
};

const INVALID_UCP_LOOKUP_RESPONSE = {
  ...VALID_UCP_LOOKUP_RESPONSE,
  products: [
    {
      ...PRODUCT,
      variants: [{ ...PRODUCT.variants[0], inputs: undefined }],
    },
  ],
};

function buildUcpCart(itemPrice: number | null) {
  return {
    currency: 'NGN',
    id: 'cart_1',
    line_items: [
      {
        id: 'line_1',
        item: lineItemItem(itemPrice),
        quantity: 2,
        totals: SUCCESS_TOTALS,
      },
    ],
    totals: SUCCESS_TOTALS,
    ucp: ucpEnvelope('dev.ucp.shopping.cart'),
  };
}

export const VALID_UCP_CART = buildUcpCart(3998);

const INVALID_UCP_CART = buildUcpCart(null);

const VALID_UCP_ORDER = {
  checkout_id: 'checkout_1',
  currency: 'NGN',
  fulfillment: { events: [], expectations: [] },
  id: 'order_1',
  line_items: [
    {
      id: 'line_1',
      item: lineItemItem(3998),
      quantity: { fulfilled: 0, total: 2 },
      status: 'processing',
      totals: [{ amount: 7996, display_text: 'Total', type: 'total' }],
    },
  ],
  permalink_url: 'https://shop.example.com/orders/order_1',
  totals: SUCCESS_TOTALS,
  ucp: ucpEnvelope('dev.ucp.shopping.order'),
};

const INVALID_UCP_ORDER = {
  ...VALID_UCP_ORDER,
  totals: [SUCCESS_TOTALS[0]],
};

const VALID_UCP_RESPONSE_METADATA = ucpEnvelope('dev.ucp.shopping.cart');

const INVALID_UCP_RESPONSE_METADATA = {
  status: 'ok',
  version: 'April 2026',
};

const VALID_UCP_PLATFORM_CAPABILITY = {
  schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
  spec: 'https://ucp.dev/2026-04-08/specification/cart',
  version: VERSION,
};

const INVALID_UCP_PLATFORM_CAPABILITY = { version: VERSION };

interface UcpSchemaSampleCase {
  readonly invalid: unknown;
  /** A substring of the violation the validator must report for `invalid`. */
  readonly invalidError: string;
  readonly name: string;
  readonly ref: UcpSchemaRef;
  readonly valid: unknown;
}

/** One valid and one invalid sample for each schema reference the validator exposes. */
export const UCP_SCHEMA_SAMPLE_CASES: readonly UcpSchemaSampleCase[] = [
  {
    invalid: INVALID_UCP_BUSINESS_PROFILE,
    invalidError: "must have required property 'payment_handlers'",
    name: 'discovery profile (profile_schema.json)',
    ref: UCP_SCHEMAS.businessProfile,
    valid: VALID_UCP_BUSINESS_PROFILE,
  },
  {
    invalid: INVALID_UCP_RESPONSE_METADATA,
    invalidError: 'must match pattern',
    name: 'response metadata (ucp.json)',
    ref: UCP_SCHEMAS.responseCartMetadata,
    valid: VALID_UCP_RESPONSE_METADATA,
  },
  {
    invalid: INVALID_UCP_PLATFORM_CAPABILITY,
    invalidError: "must have required property 'schema'",
    name: 'platform capability (capability.json)',
    ref: UCP_SCHEMAS.platformCapability,
    valid: VALID_UCP_PLATFORM_CAPABILITY,
  },
  {
    invalid: INVALID_UCP_SEARCH_RESPONSE,
    invalidError: 'must be integer',
    name: 'catalog search response (catalog_search.json)',
    ref: UCP_SCHEMAS.catalogSearchResponse,
    valid: VALID_UCP_SEARCH_RESPONSE,
  },
  {
    invalid: INVALID_UCP_LOOKUP_RESPONSE,
    invalidError: "must have required property 'inputs'",
    name: 'catalog lookup response (catalog_lookup.json)',
    ref: UCP_SCHEMAS.catalogLookupResponse,
    valid: VALID_UCP_LOOKUP_RESPONSE,
  },
  {
    invalid: INVALID_UCP_CART,
    invalidError: "must have required property 'price'",
    name: 'cart (cart.json)',
    ref: UCP_SCHEMAS.cart,
    valid: VALID_UCP_CART,
  },
  {
    invalid: INVALID_UCP_ORDER,
    invalidError: 'must contain at least 1 and no more than 1 valid item(s)',
    name: 'order (order.json)',
    ref: UCP_SCHEMAS.order,
    valid: VALID_UCP_ORDER,
  },
];
