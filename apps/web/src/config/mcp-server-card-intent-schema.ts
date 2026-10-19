/** Draft-07 JSON Schema mirror of mcpDiscoveryIntentSchema for the public server card. */
const SEARCH_PRODUCTS_INTENT_TEXT = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  // Mirrors z.string().trim().min(1): ECMA \S covers exactly the
  // whitespace trim() removes, so whitespace-only strings fail here too.
  pattern: '.*\\S.*',
} as const;

const SEARCH_PRODUCTS_INTENT_ALTERNATIVE = {
  type: 'object',
  properties: {
    product_type: SEARCH_PRODUCTS_INTENT_TEXT,
    brands: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: SEARCH_PRODUCTS_INTENT_TEXT,
    },
    model: SEARCH_PRODUCTS_INTENT_TEXT,
    compatible_with: SEARCH_PRODUCTS_INTENT_TEXT,
    attributes: {
      type: 'array',
      maxItems: 10,
      items: {
        oneOf: [
          {
            description:
              'Numeric specification: numeric keys take a non-negative number with eq/gte/lte.',
            type: 'object',
            properties: {
              key: {
                type: 'string',
                enum: [
                  'storage_gb',
                  'ram_gb',
                  'power_w',
                  'screen_inches',
                  'refresh_hz',
                ],
              },
              operator: { type: 'string', enum: ['eq', 'gte', 'lte'] },
              value: {
                description:
                  'Zero or a realistic magnitude: at least 1e-6, at most 1e9.',
                anyOf: [
                  { const: 0 },
                  {
                    type: 'number',
                    minimum: 0.000001,
                    maximum: 1000000000,
                  },
                ],
              },
            },
            required: ['key', 'operator', 'value'],
            additionalProperties: false,
          },
          {
            description:
              'Text attribute: text keys take a string with eq only.',
            type: 'object',
            properties: {
              key: {
                type: 'string',
                enum: ['color', 'connector', 'processor', 'connectivity'],
              },
              operator: { type: 'string', enum: ['eq'] },
              value: SEARCH_PRODUCTS_INTENT_TEXT,
            },
            required: ['key', 'operator', 'value'],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  additionalProperties: false,
} as const;

// An alternative is constrained when it carries any non-empty field. brands
// is minItems 1 whenever present, so only attributes needs an explicit
// length; this mirrors the runtime refinement exactly, including the
// empty-attributes-array case.
const SEARCH_PRODUCTS_INTENT_CONSTRAINED_ALTERNATIVE = {
  anyOf: [
    { required: ['product_type'] },
    { required: ['brands'] },
    { required: ['model'] },
    { required: ['compatible_with'] },
    { required: ['attributes'], properties: { attributes: { minItems: 1 } } },
  ],
} as const;

export const SEARCH_PRODUCTS_INTENT_SCHEMA = {
  description:
    'Structured shopper intent. alternatives are OR; each branch is AND. Use singular canonical product types phone/laptop/tablet/charger/cable/security_camera/fragrance_diffuser. Brand means manufacturer, compatible_with means supported device model. Attributes use canonical units (storage_gb/ram_gb in GB, power_w in watts) and eq/gte/lte. Use an empty alternative for broad discovery; never invent unspecified constraints.',
  type: 'object',
  properties: {
    alternatives: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: SEARCH_PRODUCTS_INTENT_ALTERNATIVE,
      // Mirrors the runtime refinement: a lone alternative may browse
      // unconstrained, but alongside siblings every branch must constrain.
      anyOf: [
        { maxItems: 1 },
        { items: SEARCH_PRODUCTS_INTENT_CONSTRAINED_ALTERNATIVE },
      ],
    },
    excluded_product_types: {
      type: 'array',
      maxItems: 10,
      items: SEARCH_PRODUCTS_INTENT_TEXT,
    },
  },
  required: ['alternatives'],
  additionalProperties: false,
} as const;
