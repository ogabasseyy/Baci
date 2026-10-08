import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestPrimaryWalletOnboardingSchema = z.strictObject({
  consent: z.literal(true),
  bvn: z.string().regex(/^\d{11}$/),
});

export const piggyvestPrimaryWalletIdentitySchema = z.strictObject({
  merchantId: z.uuid(),
  customerId: z.uuid(),
  userId: z.uuid(),
  email: z.email(),
  emailVerified: z.literal(true),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(20),
});

export const piggyvestPrimaryWalletConfigurationSchema = z.strictObject({
  environment: z.enum(['staging', 'production']),
  merchantId: z.uuid(),
  integrationId: z.uuid(),
  businessId: piggyvestProviderIdSchema,
  businessBindingVerified: z.literal(true),
  fingerprintKey: z.string().min(32).max(512),
});

export const piggyvestPrimaryWalletCreationSchema = z.strictObject({
  customer_id: piggyvestProviderIdSchema,
  wallet_id: piggyvestProviderIdSchema,
  new_customer: z.boolean(),
});
