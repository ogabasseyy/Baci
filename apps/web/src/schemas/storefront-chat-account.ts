import z from 'zod';

const order = z.object({
  id: z.uuid(),
  order_number: z.string().max(100).nullish(),
  payment_method: z.string().max(80).nullish(),
  payment_status: z.string().max(80).nullable(),
  shipping_status: z.string().max(80).nullable(),
  shipping_provider: z.string().max(80).nullish(),
  tracking_number: z.string().max(100).nullish(),
});

const trackingEvent = z.object({
  status: z.string().max(120),
  description: z.string().max(300),
  location: z.string().max(160).nullable(),
  timestamp: z.string().max(64),
});

const trackingResponse = z.discriminatedUnion('trackingAvailable', [
  z.object({
    trackingAvailable: z.literal(false),
    reason: z.string().max(200),
  }),
  z.object({
    trackingAvailable: z.literal(true),
    tracking: z.object({
      provider: z.string().max(80),
      carrierName: z.string().max(120),
      trackingNumber: z.string().max(100),
      status: z.string().max(80),
      statusLabel: z.string().max(120),
      estimatedDelivery: z.string().max(64).nullable(),
      actualDelivery: z.string().max(64).nullable(),
      events: z.array(trackingEvent),
      liveUnavailable: z.boolean(),
    }),
  }),
]);

/** Only the fields needed by account controls are retained from the response. */
export const storefrontChatAccountSchemas = {
  orders: z.object({ orders: z.array(order) }),
  cancellation: z.object({ success: z.literal(true), cancelled: z.boolean() }),
  tracking: trackingResponse,
};

export type StorefrontChatOrder = z.infer<typeof order>;
export type StorefrontChatOrderTracking = z.infer<typeof trackingResponse>;
