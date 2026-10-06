import { z } from 'zod';

export const piggyvestStagingWalletResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.string().min(1),
    business_id: z.string().min(1),
    api_customer_id: z.string().min(1).max(512).regex(/^\S+$/).nullish(),
    currency: z.string().min(1),
    balance: z.number().finite(),
    status: z.string().min(1),
  }),
});

export type PiggyvestStagingWalletResponse = z.infer<
  typeof piggyvestStagingWalletResponseSchema
>;
