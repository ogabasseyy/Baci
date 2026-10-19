import { z } from 'zod';
import { guestCartLineSchema } from './guest-cart-line';

export const storedCartSchema = z.object({
  expires_at: z.number(),
  items: z.array(guestCartLineSchema).max(20),
});
