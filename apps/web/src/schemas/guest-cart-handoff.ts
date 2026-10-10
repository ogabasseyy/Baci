import { z } from 'zod';
import { guestCartLineSchema } from './guest-cart-line';

export const guestCartHandoffSchema = z
  .array(guestCartLineSchema)
  .min(1)
  .max(20)
  .refine(
    (items) =>
      new Set(items.map((item) => item.product_id.toLowerCase())).size ===
      items.length
  );
