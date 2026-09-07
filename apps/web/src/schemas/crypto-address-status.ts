import { z } from 'zod';
import { cryptoChainSchema } from './crypto-chain-schema';

export const cryptoAddressStatusSchema = z.object({
  success: z.literal(true),
  status: z.string().trim().toLowerCase().optional(),
  crypto_address: z
    .object({
      address: z.string().min(1),
      chain: cryptoChainSchema,
      currency: z.enum(['USDT', 'USDC']),
      qrcode: z.string().optional(),
    })
    .nullable(),
});
