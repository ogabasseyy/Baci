import { z } from 'zod';

export const creditDirectWalletFundingSchema = z
  .object({
    grossAmount: z.number().finite().positive(),
    walletAmount: z.number().finite().positive(),
    financedAmount: z.number().finite().positive(),
  })
  .refine(
    (funding) =>
      Math.abs(
        funding.grossAmount - funding.walletAmount - funding.financedAmount
      ) < 0.005
  );
