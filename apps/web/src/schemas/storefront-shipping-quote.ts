import { z } from 'zod';
export const storefrontShippingQuoteReadSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  merchantId: z.uuid().optional(),
});
const optionalText = z.string().nullable();
const optionalNumber = z.number().nullable();
export const storedStorefrontShippingQuoteSchema = z.object({
  id: z.uuid(),
  session_id: z.string().max(200),
  provider: z.string(),
  service_tier: optionalText,
  carrier_name: optionalText,
  estimated_days: optionalNumber,
  min_days: optionalNumber,
  max_days: optionalNumber,
  price: z.number().nonnegative(),
  currency: z.string(),
  pickup_included: z.boolean().nullable(),
  insurance_included: z.boolean().nullable(),
  is_station_pickup: z.boolean().nullable(),
  station_name: optionalText,
  station_address: optionalText,
  provider_rate_id: optionalText,
  expires_at: z.string(),
});
export const storedStorefrontShippingQuotesSchema = z
  .array(storedStorefrontShippingQuoteSchema)
  .max(30);
export const shippingQuoteReadProofSchema = z.strictObject({
  version: z.literal('baci-shipping-quote-proof:v1'),
  action: z.literal('read_storefront_shipping_quotes'),
  issued_at: z.iso.datetime({ offset: true }),
  merchant_id: z.uuid(),
  subject_id: z.uuid(),
  payload_text: z.string().max(2048),
  proof_id: z.string().regex(/^[a-f0-9]{24}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
