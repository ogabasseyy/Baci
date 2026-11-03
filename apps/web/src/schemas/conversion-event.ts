import { z } from 'zod';

const conversionUserDataSchema = z.strictObject({
  em: z.email().max(320).optional(),
  external_id: z.string().min(1).max(200).optional(),
  fbc: z.string().min(1).max(500).optional(),
  fbp: z.string().min(1).max(500).optional(),
  fn: z.string().min(1).max(100).optional(),
  ln: z.string().min(1).max(100).optional(),
  ph: z.string().min(5).max(30).optional(),
  sccid: z.string().min(1).max(500).optional(),
  ttclid: z.string().min(1).max(500).optional(),
  ttp: z.string().min(1).max(500).optional(),
});

const conversionItemSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().max(300).optional(),
  price: z.number().nonnegative().finite().optional(),
  quantity: z.number().positive().finite().max(100_000),
});

const conversionCustomDataSchema = z.strictObject({
  content_name: z.string().max(300).optional(),
  content_type: z.enum(['product', 'product_group']).optional(),
  contents: z.array(conversionItemSchema).max(200).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  // Checkout can occur before an order exists. Normalize the legacy empty
  // sentinel away instead of rejecting an otherwise valid conversion event.
  order_id: z
    .string()
    .max(200)
    .transform((value) => value.trim() || undefined)
    .optional(),
  price: z.number().nonnegative().finite().optional(),
  search_string: z.string().max(500).optional(),
  url: z.url().max(2_000).optional(),
  value: z.number().nonnegative().finite().optional(),
});

export const conversionEventRequestSchema = z.strictObject({
  custom_data: conversionCustomDataSchema,
  event_id: z.string().min(1).max(500).optional(),
  event_name: z.string().min(1).max(100),
  event_source: z.enum(['mobile_app', 'server', 'web']),
  event_time: z.number().int().positive(),
  analytics_consent: z.boolean().optional(),
  marketing_consent: z.boolean().optional(),
  merchant_id: z.uuid().optional(),
  platform: z.enum(['android', 'ios', 'web']).optional(),
  targets: z
    .array(z.enum(['facebook', 'google', 'snapchat', 'tiktok']))
    .max(4)
    .optional(),
  user_data: conversionUserDataSchema,
});

export type ConversionEventRequest = z.infer<
  typeof conversionEventRequestSchema
>;
