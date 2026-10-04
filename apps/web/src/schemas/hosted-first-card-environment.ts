import { z } from 'zod';

// Shared public surface every hosted savings worker profile must provide.
// The parsed output carries only these public fields plus the profile
// marker: server credentials and checkout configuration never leave the
// validated environment record.
const hostedPublicEnvironmentFields = {
  NODE_ENV: z.enum(["development", "production", "test"]),
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
};

function publicEnvironmentOutput(value: {
  NODE_ENV: 'development' | 'production' | 'test';
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_APP_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  BACI_WORKER_PROFILE: string;
}) {
  return {
    NODE_ENV: value.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: value.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_APP_URL: value.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: value.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    BACI_WORKER_PROFILE: value.BACI_WORKER_PROFILE,
  };
}

const checkoutConfigJsonSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null) return false;
      const record = parsed as Record<string, unknown>;
      return (
        record.deployment === 'staging' &&
        typeof record.authOrigin === 'string' &&
        typeof record.publicOrigin === 'string' &&
        typeof record.expiresAt === 'string' &&
        // The staging lease caps the test amount: anything above the
        // reviewed ceiling refuses the launch.
        Number.isSafeInteger(record.maximumAmountKobo) &&
        (record.maximumAmountKobo as number) >= 0 &&
        (record.maximumAmountKobo as number) <= 10_000
      );
    } catch {
      return false;
    }
  }, 'Invalid checkout configuration');

export const hostedFirstCardEnvironmentSchema = z
  .object({
    ...hostedPublicEnvironmentFields,
    BACI_WORKER_PROFILE: z.literal('hosted-first-card-checkout'),
    PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: z.literal('true'),
    PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: checkoutConfigJsonSchema,
    PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: z
      .enum(['true', 'false'])
      .optional(),
    // The public checkout surface must stay disabled: only the explicit
    // false marker (or its absence) is accepted, never true.
    PREFUNDED_CARD_PUBLIC_ENABLED: z.literal('false').optional(),
    // Inherited service credentials must never enter an isolated worker.
    SUPABASE_SERVICE_ROLE_KEY: z.never().optional(),
  })
  .transform((value) => ({
    ...publicEnvironmentOutput(value),
    PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED:
      value.PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED,
  }));
