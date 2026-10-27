import { z } from 'zod';

const id = z.uuid();
const sourceVersion = z.string().regex(/^[0-9a-f]{64}$/i);
const draftValue = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.number().int().nonnegative()),
]);

export const jumiaProductPreflightMappingSchema = z
  .object({
    productId: id,
    category: z
      .object({ code: z.number().int().positive(), name: z.string().min(1) })
      .strict(),
    brand: z
      .object({ code: z.number().int().positive(), name: z.string().min(1) })
      .strict(),
    attributeSetId: id,
    attributes: z.record(z.string(), draftValue),
    bullets: z.array(z.string()).min(4).max(7),
    variation: z
      .object({ sourceAttributeName: z.string().min(1).max(128) })
      .strict()
      .optional(),
    categoryConfirmed: z.literal(true),
  })
  .strict();

export const jumiaProductPreflightRequestSchema = z
  .object({
    merchantId: id,
    integrationId: id,
    businessClientCode: z.string().min(1).max(128),
    selectionId: id,
    sourceCategoryId: id,
    sourcePage: z
      .object({
        page: z.number().int().min(1).max(100_000),
        limit: z.number().int().min(1).max(100),
      })
      .strict(),
    products: z
      .array(z.object({ productId: id, sourceVersion }).strict())
      .min(1)
      .max(100),
    mappings: z.array(jumiaProductPreflightMappingSchema).min(1).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.products.map((product) => product.productId);
    const mappingIds = request.mappings.map((mapping) => mapping.productId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        path: ['products'],
        message: 'Product IDs must be unique.',
      });
    if (
      new Set(mappingIds).size !== mappingIds.length ||
      ids.length !== mappingIds.length ||
      ids.some((productId) => !mappingIds.includes(productId))
    )
      context.addIssue({
        code: 'custom',
        path: ['mappings'],
        message: 'Provide exactly one mapping for every selected product.',
      });
  });

export const jumiaProductPreflightResponseSchema = z
  .object({
    scope: z
      .object({
        selectionId: id,
        sourceCategoryId: id,
        sourcePage: z
          .object({ page: z.number().int(), limit: z.number().int() })
          .strict(),
        productIds: z.array(id).min(1).max(100),
      })
      .strict(),
    digest: z.string().regex(/^jumia-preflight-v1:[0-9a-f]{64}$/),
    products: z
      .array(
        z
          .object({
            productId: id,
            sourceVersion,
            locallyValid: z.boolean(),
            blockers: z.array(z.string().min(1)),
            recordCount: z.number().int().min(0),
          })
          .strict()
      )
      .min(1)
      .max(100),
    canSubmit: z.literal(false),
  })
  .strict();

export type JumiaProductPreflightRequest = z.infer<
  typeof jumiaProductPreflightRequestSchema
>;
export type JumiaProductPreflightResponse = z.infer<
  typeof jumiaProductPreflightResponseSchema
>;
