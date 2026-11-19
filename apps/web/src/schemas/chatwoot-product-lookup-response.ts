import { z } from 'zod';
import { chatwootProductCardSchema } from './chatwoot-product-card';

const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

const unavailableCode = z.enum([
  'forbidden',
  'invalid_request',
  'invalid_context',
  'product_unavailable',
  'quota_exceeded',
  'temporarily_unavailable',
  'unsupported_condition_offers',
]);

export const chatwootProductLookupResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      product: chatwootProductCardSchema,
      requestId,
    })
    .strict(),
  z
    .object({
      code: unavailableCode,
      ok: z.literal(false),
      requestId: requestId.optional(),
    })
    .strict(),
]);
