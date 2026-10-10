import { z } from 'zod';
import { piggyvestPrimaryWalletRuntimeSchema } from './piggyvest-primary-wallet-runtime';

export const piggyvestPrimaryInflowRuntimeSchema = z.strictObject({
  integrationId: z.uuid(),
  environment: z.enum(['staging', 'production']),
  database: piggyvestPrimaryWalletRuntimeSchema.shape.database.extend({
    login: z.literal('baci_piggyvest_primary_evidence'),
  }),
});
