import { z } from 'zod';
import { cryptoChainSchema } from './crypto-chain-schema';

const cryptoPaymentSchema = z.object({
  address: z.string(),
  chain: cryptoChainSchema,
  currency: z.enum(['USDT', 'USDC']),
  amount: z.number().nonnegative(),
  crypto_amount: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  confirmation_time: z.string(),
  payment_id: z.string().optional(),
  qrcode: z.string().optional(),
});
const responseFields = {
  success: z.literal(true),
  reference: z.string(),
  session_id: z.string().optional(),
  crypto_payment: cryptoPaymentSchema,
};

export const cryptoInitializationResponseSchema = z
  .discriminatedUnion('crypto_address_pending', [
    z.object({ ...responseFields, crypto_address_pending: z.literal(true) }),
    z.object({
      ...responseFields,
      crypto_address_pending: z.literal(false).optional(),
    }),
  ])
  .superRefine((response, context) => {
    const payment = response.crypto_payment;
    if (response.crypto_address_pending && payment.address === '') return;
    const validAddress =
      payment.chain === 'TRX'
        ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(payment.address)
        : /^0x[a-fA-F0-9]{40}$/.test(payment.address);
    if (!validAddress)
      context.addIssue({
        code: 'custom',
        path: ['crypto_payment', 'address'],
        message: 'Invalid crypto payment address',
      });
  });
