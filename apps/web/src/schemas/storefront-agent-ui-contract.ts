import z from 'zod';

const httpImageUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Product images must use HTTP or HTTPS');

const productSchema = z
  .object({
    condition: z.string().max(120).nullable().optional(),
    minimumOrderQuantity: z.number().int().positive().nullable().optional(),
    availableConditions: z
      .array(z.string().max(120))
      .max(20)
      .nullable()
      .optional(),
    hasConditionOffers: z.boolean().nullable().optional(),
    variantModel: z.string().max(120).nullable().optional(),
    brand: z.string().trim().min(1).max(120).nullable(),
    category: z.string().trim().min(1).max(120).nullable(),
    description: z.string().trim().max(320).nullable(),
    hasVariants: z.boolean(),
    id: z.string().trim().min(1).max(128),
    imageUrl: httpImageUrlSchema.nullable(),
    manageStock: z.boolean(),
    name: z.string().trim().min(1).max(200),
    price: z.number().finite().nonnegative().max(1_000_000_000_000),
    quantity: z.number().int().min(1).max(99).optional(),
    slug: z.string().trim().min(1).max(240).nullable(),
    stock: z.number().int().nonnegative().nullable(),
  })
  .strict();

const eventSchema = z.discriminatedUnion('type', [
  z
    .object({
      intent: z.enum(['discover', 'details', 'recommend', 'add_to_cart']),
      products: z.array(productSchema).min(1).max(6),
      title: z.string().trim().min(1).max(80),
      type: z.literal('present_products'),
    })
    .strict(),
]);

const responseSchema = z
  .object({
    events: z.array(eventSchema).max(3),
    text: z.string().trim().min(1).max(100_000),
    version: z.literal(1),
  })
  .strict();

/**
 * Versioned, allowlisted contract between the storefront chat runtime and its
 * trusted renderer. The model never supplies component names, URLs, or event
 * actions directly; server-owned commerce tool results are mapped into this
 * bounded contract first.
 */
export const storefrontAgentUiContract = {
  eventSchema,
  maxEvents: 3,
  maxProductsPerEvent: 6,
  mediaType: 'application/vnd.baci.storefront-agent-ui+json',
  responseSchema,
} as const;

export type StorefrontAgentUiEvent = z.infer<typeof eventSchema>;
export type StorefrontAgentUiProduct = z.infer<typeof productSchema>;
export type StorefrontAgentUiResponse = z.infer<typeof responseSchema>;
