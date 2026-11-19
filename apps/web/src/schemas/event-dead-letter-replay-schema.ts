import { z } from 'zod';

export const eventDeadLetterReplaySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    failure_id: z.uuid(),
    kind: z.literal('ingress'),
    reason: z.string().trim().min(3).max(1_000),
  }),
  z.strictObject({
    delivery_ids: z.array(z.uuid()).min(1).max(100),
    kind: z.literal('delivery'),
    reason: z.string().trim().min(3).max(1_000),
  }),
  z.strictObject({
    destination: z.enum([
      'facebook',
      'ga4',
      'snapchat',
      'tiktok',
      'chatgpt',
      'x',
    ]),
    error_code: z.string().min(1).max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    kind: z.literal('delivery_filter'),
    merchant_id: z.uuid().optional(),
    reason: z.string().trim().min(3).max(1_000),
    status: z.enum(['dead_letter', 'delivery_unknown']).default('dead_letter'),
    to: z.iso.datetime({ offset: true }).optional(),
  }),
]);
