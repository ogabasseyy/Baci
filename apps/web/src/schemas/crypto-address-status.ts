import { z } from 'zod';

export const cryptoAddressStatusSchema = z.object({
  success: z.literal(true),
  crypto_address: z
    .object({
      address: z.string().min(1),
      chain: z.enum(['TRX', 'ETH', 'MATIC', 'AVAXC']),
      currency: z.enum(['USDT', 'USDC']),
      qrcode: z.string().optional(),
    })
    .nullable(),
});
