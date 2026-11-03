import { z } from 'zod';

const analyticsItemSchema = z.strictObject({
  id: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(300).optional(),
  price: z.number().nonnegative().finite().optional(),
  product_id: z.string().min(1).max(200).optional(),
  product_name: z.string().min(1).max(300).optional(),
  quantity: z.number().positive().finite(),
});

const analyticsUserDataSchema = z.strictObject({
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

const ANALYTICS_CUSTOM_DATA_FIELDS = new Set([
  'content_name',
  'content_type',
  'contents',
  'currency',
  'order_id',
  'price',
  'search_string',
  'url',
  'value',
]);

const analyticsCustomDataSchema = z
  .looseObject({
    content_name: z.string().max(300).optional(),
    content_type: z.enum(['product', 'product_group']).optional(),
    contents: z.array(analyticsItemSchema).max(200).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    order_id: z
      .string()
      .max(200)
      .transform((value) => value.trim() || undefined)
      .optional(),
    price: z.number().nonnegative().finite().optional(),
    search_string: z.string().max(500).optional(),
    url: z.url().max(2_000).optional(),
    value: z.number().nonnegative().finite().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length > 50) {
      context.addIssue({
        code: 'custom',
        message: 'custom_data has too many fields',
      });
    }
    for (const [key, entry] of Object.entries(value)) {
      if (ANALYTICS_CUSTOM_DATA_FIELDS.has(key)) continue;
      const valid =
        (typeof entry === 'string' && entry.length <= 500) ||
        (typeof entry === 'number' && Number.isFinite(entry)) ||
        typeof entry === 'boolean';
      if (!valid) {
        context.addIssue({
          code: 'custom',
          message: 'custom_data extras must be bounded primitive values',
          path: [key],
        });
      }
    }
  });

export const analyticsEventRequestSchema = z
  .strictObject({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    custom_data: analyticsCustomDataSchema.optional(),
    event_id: z.string().min(1).max(500).optional(),
    event_name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .optional(),
    event_type: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .optional(),
    item_count: z.number().int().nonnegative().max(10_000).optional(),
    items: z.array(analyticsItemSchema).max(200).optional(),
    analytics_consent: z.boolean().optional(),
    marketing_consent: z.boolean().optional(),
    merchant_id: z.uuid(),
    order_id: z
      .string()
      .max(200)
      .transform((value) => value.trim() || undefined)
      .optional(),
    page_url: z.url().max(2_000).optional(),
    product_category: z.string().max(300).optional(),
    product_id: z.string().min(1).max(200).optional(),
    product_name: z.string().max(300).optional(),
    product_price: z.number().nonnegative().finite().optional(),
    quantity: z.number().positive().finite().max(100_000).optional(),
    referrer: z.url().max(2_000).optional(),
    results_count: z.number().int().nonnegative().max(10_000_000).optional(),
    search_term: z.string().max(500).optional(),
    session_id: z.string().max(200).optional(),
    shipping: z.number().nonnegative().finite().optional(),
    source: z.enum(['mobile_app', 'server', 'web']).optional(),
    subtotal: z.number().nonnegative().finite().optional(),
    tax: z.number().nonnegative().finite().optional(),
    timestamp: z.iso.datetime({ offset: true }).optional(),
    total: z.number().nonnegative().finite().optional(),
    user_agent: z.string().max(1_000).optional(),
    user_data: analyticsUserDataSchema.optional(),
  })
  .refine((value) => value.event_type || value.event_name, {
    message: 'event_type or event_name is required',
    path: ['event_type'],
  });

export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;
