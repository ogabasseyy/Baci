import { z } from 'zod';
import { piggyvestPrimaryWalletConfigurationSchema } from './piggyvest-primary-wallet-onboarding';

export const piggyvestPrimaryWalletRuntimeSchema = z.strictObject({
  onboarding: piggyvestPrimaryWalletConfigurationSchema,
  providerToken: z.string().min(1).max(4096),
  database: z.strictObject({
    host: z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    port: z.int().min(1).max(65535),
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/),
    login: z.literal('baci_piggyvest_primary_provisioner'),
    password: z.string().min(1).max(4096),
    certificateAuthority: z.string().min(1).max(32768),
  }),
});
