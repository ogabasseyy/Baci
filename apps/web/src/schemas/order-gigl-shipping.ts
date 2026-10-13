import { z } from 'zod';

const latitude = z.number().finite().min(-90).max(90).optional();
const longitude = z.number().finite().min(-180).max(180).optional();

const receiverOverride = z
  .object({
    address: z.string().trim().min(1),
    city: z.string().trim().min(1).optional(),
    state: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1),
    latitude,
    longitude,
  })
  .strict()
  .superRefine((receiver, context) => {
    const hasLatitude = receiver.latitude !== undefined;
    const hasLongitude = receiver.longitude !== undefined;
    if (hasLatitude === hasLongitude) return;

    context.addIssue({
      code: 'custom',
      message: 'Latitude and longitude must be provided together',
      path: [hasLatitude ? 'longitude' : 'latitude'],
    });
  });

export const orderGiglQuoteSchema = z.object({
  receiver: receiverOverride.optional(),
  preview: z.boolean().optional(),
});

export const adminOrderGiglQuoteSchema = orderGiglQuoteSchema.extend({
  admin_order_id: z.string().uuid(),
});

export type OrderGiglQuoteInput = z.infer<typeof orderGiglQuoteSchema>;
