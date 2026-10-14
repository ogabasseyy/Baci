import { z } from 'zod';

export const shippingCheckoutRecoverySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('preview'),
    receiver: z.strictObject({
      address: z.string().trim().min(1).max(500),
      city: z.string().trim().min(1).max(120),
      state: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(10).max(30),
      countryCode: z.string().trim().max(8).optional(),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    }),
  }),
  z.strictObject({
    action: z.literal('confirm'),
    previewId: z.uuid(),
    confirmDestination: z.literal(true),
  }),
]);
