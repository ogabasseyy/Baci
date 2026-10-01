import { z } from 'zod';

export const adminMerchantsQuerySchema = z.object({
  health: z
    .enum(['all', 'healthy', 'at_risk', 'churned', 'new'])
    .default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(['gmv', 'orders', 'joined']).default('gmv'),
});

export type AdminMerchantsSortBy = z.infer<
  typeof adminMerchantsQuerySchema
>['sortBy'];

export type AdminMerchantsQuery = z.infer<typeof adminMerchantsQuerySchema>;
