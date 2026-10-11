import { z } from 'zod';
import { piggyvestPrimaryWalletOnboardingSchema } from './piggyvest-primary-wallet-onboarding';

export const piggyvestPrimaryWalletQuerySchema = z.strictObject({
  merchantId: z.uuid(),
});

export const piggyvestPrimaryWalletRequestSchema =
  piggyvestPrimaryWalletOnboardingSchema.extend({
    merchantId: z.uuid(),
  });
