import { z } from 'zod';

export const cryptoInitializationResponseSchema = z.object({
  success: z.boolean(),
  reference: z.string(),
  session_id: z.string().optional(),
  crypto_payment: z
    .object({
      address: z.string().min(1),
      chain: z.enum(['TRX', 'ETH', 'MATIC', 'AVAXC']),
      currency: z.enum(['USDT', 'USDC']),
      amount: z.number().nonnegative(),
      crypto_amount: z
        .string()
        .regex(/^\d+(?:\.\d+)?$/)
        .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
      confirmation_time: z.string(),
      payment_id: z.string().optional(),
      qrcode: z.string().optional(),
    })
    .refine(
      (payment) =>
        payment.chain === 'TRX'
          ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(payment.address)
          : /^0x[a-fA-F0-9]{40}$/.test(payment.address),
      { message: 'Invalid crypto payment address' }
    )
    .optional(),
});
