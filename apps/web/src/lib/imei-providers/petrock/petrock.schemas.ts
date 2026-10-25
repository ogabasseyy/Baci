import { z } from 'zod';

const responseEnvelope = {
  status: z.literal('success').optional(),
  code: z.coerce.number().int().min(200).max(299).optional(),
};

export const petrockAccountResponseSchema = z
  .object({
    ...responseEnvelope,
    data: z
      .object({
        balance: z.coerce.number(),
        currency: z.string().transform((value) => value.trim().toUpperCase()),
      })
      .loose(),
  })
  .loose();

const petrockPriceSchema = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? null : value,
  z.coerce.number().nonnegative().nullable()
);

const petrockCategoryIdsSchema = z
  .union([
    z.array(z.coerce.string()),
    z.coerce.string().transform((value) => [value]),
  ])
  .optional()
  .default([]);

export const petrockProductFieldSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean().optional(),
    type: z.string().optional(),
  })
  .loose();

export const petrockProductSchema = z
  .object({
    cid: z.coerce.string().optional(),
    cids: petrockCategoryIdsSchema,
    fields: z.array(petrockProductFieldSchema).optional().default([]),
    name: z.string().min(1),
    price: petrockPriceSchema,
    time: z.string().optional(),
    type: z.string().min(1),
  })
  .loose();

export const petrockProductsResponseSchema = z
  .object({
    ...responseEnvelope,
    data: z
      .object({
        categories: z
          .record(z.string(), z.object({ name: z.string().min(1) }).loose())
          .optional()
          .default({}),
        currency: z.string().optional().default('USD'),
        products: z.record(z.string(), petrockProductSchema),
      })
      .loose(),
  })
  .loose();

const petrockOrderIdSchema = z.union([
  z.string().trim().min(1),
  z.number().int().positive().transform(String),
]);

export const petrockOrderStatusSchema = z
  .enum([
    'new',
    'pre-checking',
    'accepted',
    'in-process',
    'pending',
    'verify',
    'success',
    'rejected',
    'reject',
  ])
  .transform((status): 'new' | 'in-process' | 'success' | 'reject' => {
    if (status === 'success' || status === 'new') return status;
    if (status === 'reject' || status === 'rejected') return 'reject';
    return 'in-process';
  });

export const petrockSubmitOrderResponseSchema = z
  .object({
    ...responseEnvelope,
    data: z
      .array(
        z.array(
          z
            .object({
              order_uuid: petrockOrderIdSchema,
              reference_id: z.coerce.string().optional(),
            })
            .loose()
        )
      )
      .min(1),
  })
  .loose();

export const petrockOrderResponseSchema = z
  .object({
    ...responseEnvelope,
    data: z
      .object({
        order_uuid: petrockOrderIdSchema.optional(),
        reference_id: z.coerce.string().optional(),
        replay: z.preprocess(
          (value) => (value === null ? undefined : value),
          z.string().optional().default('')
        ),
        status: petrockOrderStatusSchema,
      })
      .loose(),
  })
  .loose()
  .refine(
    (response) =>
      response.data.status !== 'success' ||
      response.data.replay.trim().length > 0,
    {
      message: 'A completed Petrock order must include a result',
      path: ['data', 'replay'],
    }
  );
