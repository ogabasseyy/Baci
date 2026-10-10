import { z } from 'zod';
import { primaryWalletCardCheckoutSchemas } from './primary-wallet-card-checkout';

const database = z.strictObject({
  host: z
    .string()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
  port: z.number().int().min(1).max(65535),
  name: z
    .string()
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/),
  password: z.string().min(1).max(4096),
  certificateAuthority: z.string().min(1).max(32768),
});

export const primaryWalletCardCheckoutRuntimeSchema = z.strictObject({
  settings: primaryWalletCardCheckoutSchemas.settings,
  authorizer: database.extend({
    login: z.literal('baci_primary_card_authorizer'),
  }),
  evidence: database.extend({ login: z.literal('baci_primary_card_evidence') }),
});
