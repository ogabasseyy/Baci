import { z } from 'zod';
import { piggyvestPrimaryWalletRuntimeSchema } from './piggyvest-primary-wallet-runtime';

/**
 * Connection settings of the PiggyVest webhook receiver's restricted
 * database login. Same host, port, name and CA as the primary-wallet
 * logins; only the login and its password differ.
 */
export const piggyvestWebhookIntakeRuntimeSchema = z.strictObject({
  database: piggyvestPrimaryWalletRuntimeSchema.shape.database.extend({
    login: z.literal('baci_piggyvest_webhook_intake'),
  }),
});

export type PiggyvestWebhookIntakeRuntime = z.infer<
  typeof piggyvestWebhookIntakeRuntimeSchema
>;
