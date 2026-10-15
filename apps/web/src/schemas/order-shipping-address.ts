import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';
import { shippingCoordinatePairSchema } from './shipping-coordinate-pair';

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
