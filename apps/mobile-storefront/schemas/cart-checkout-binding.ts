import { z } from 'zod';
/** Cart provenance only; existing checkout authorization still controls purchase. */
export const cartCheckoutBindingSchema = z.strictObject({
  cart_id: z.uuid(),
  checkout_session_id: z.uuid(),
  checkout_generation: z.number().int().positive(),
  cart_version: z.number().int().positive(),
});
export type CartCheckoutBinding = z.infer<typeof cartCheckoutBindingSchema>;
