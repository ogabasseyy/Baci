import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

export const shippingCoordinatePairSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .superRefine((pair, ctx) => {
    const hasLatitude = pair.latitude !== undefined;
    const hasLongitude = pair.longitude !== undefined;
    if (hasLatitude === hasLongitude) return;
    ctx.addIssue({
      code: 'custom',
      message: 'Latitude and longitude must be provided together',
      path: [hasLatitude ? 'longitude' : 'latitude'],
    });
  });

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value ? sanitizeText(value) : value));

export const orderShippingAddressSchema =
  shippingCoordinatePairSchema.safeExtend({
    address: z
      .string()
      .min(1)
      .transform((value) => sanitizeText(value)),
    city: optionalText,
    state: optionalText,
    country: optionalText,
    countryCode: optionalText,
    postalCode: optionalText,
  });
