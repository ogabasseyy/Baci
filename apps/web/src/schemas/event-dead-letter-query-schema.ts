import { z } from 'zod';

export const eventDeadLetterQuerySchema = z.strictObject({
  destination: z
    .enum(['facebook', 'ga4', 'snapchat', 'tiktok', 'chatgpt', 'x'])
    .optional(),
  error_code: z.string().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  kind: z.enum(['all', 'delivery', 'ingress', 'unknown']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  merchant_id: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type EventDeadLetterQuery = z.infer<typeof eventDeadLetterQuerySchema>;
