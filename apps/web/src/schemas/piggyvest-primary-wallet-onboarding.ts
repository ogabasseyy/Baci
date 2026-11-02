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

// Post-onboarding authorization: immutable IDs plus the verified auth
// email only. Name and phone are mutable profile contact data —
// clearing an optional phone must never lock a customer out of wallet
// reads, recovery, or submissions to an already-bound wallet.
export const piggyvestPrimaryWalletReadIdentitySchema =
  piggyvestPrimaryWalletIdentitySchema.pick({
    merchantId: true,
    customerId: true,
    userId: true,
    email: true,
    emailVerified: true,
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

// PiggyVest wallet ids read back as uppercase Crockford ULIDs (proof p7,
// 2026-10-31). Checked exactly, untrimmed, so a mistyped or padded value
// fails closed instead of reaching an immutable provider setting.
export const piggyvestInterestPayoutWalletIdSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

// Onboarding alone needs the Ogabassey wallet that receives main-wallet
// interest; the shared runtime configuration stays unchanged.
export const piggyvestPrimaryWalletOnboardingConfigurationSchema =
  piggyvestPrimaryWalletConfigurationSchema.extend({
    interestPayoutWalletId: piggyvestInterestPayoutWalletIdSchema,
  });

// GET /wallet/:id after creation. Identity is required; the interest
// settings may be absent or null while a new wallet settles.
export const piggyvestPrimaryWalletInterestReadbackSchema = z.object({
  id: piggyvestProviderIdSchema,
  api_customer_id: piggyvestProviderIdSchema,
  business_id: piggyvestProviderIdSchema,
  interest_enabled: z.boolean().nullable().optional(),
  interest_payout_wallet: piggyvestProviderIdSchema.nullable().optional(),
});
