import { z } from 'zod';
import { WalletFundingAccountSchema } from './wallet-funding-account';

export const PiggyvestPrimaryWalletSchemas = {
  create: z.strictObject({
    merchantId: z.uuid(),
    bvn: z.string().regex(/^\d{11}$/, 'Enter a valid 11-digit BVN.'),
    consent: z.literal(true, { error: 'Please accept wallet setup.' }),
  }),
  created: z.strictObject({ status: z.enum(['pending', 'ready']) }),
  snapshot: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('pending'), account: z.null() }),
    z.strictObject({
      status: z.literal('ready'),
      balanceKobo: z.int().nonnegative(),
      account: WalletFundingAccountSchema.extend({
        provider: z.literal('piggyvest'),
      }),
    }),
  ]),
};
