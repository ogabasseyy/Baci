import { z } from 'zod';

export const cryptoAddressStatusSchema = z.object({
  success: z.literal(true),
  status: z.string().trim().toLowerCase().optional(),
  crypto_address: z
    .object({
      address: z.string().min(1),
      chain: z
        .string()
        .trim()
        .toUpperCase()
        .transform((value) => {
          const aliases: Record<string, string> = {
            TRON: 'TRX',
            ETHEREUM: 'ETH',
            POLYGON: 'MATIC',
            AVALANCHE: 'AVAXC',
          };
          return aliases[value] ?? value;
        })
        .pipe(z.enum(['TRX', 'ETH', 'MATIC', 'AVAXC'])),
      currency: z.enum(['USDT', 'USDC']),
      qrcode: z.string().optional(),
    })
    .nullable(),
});
