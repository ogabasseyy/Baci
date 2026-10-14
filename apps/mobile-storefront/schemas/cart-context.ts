import { z } from 'zod';
export const nativeCartContextSchema = z.object({
  merchantId: z.uuid(),
  principalId: z.string().min(1).max(128),
  scope: z.enum(['bootstrap', 'session']),
  cartId: z.uuid().nullable(),
  exp: z.number().int().positive(),
});
