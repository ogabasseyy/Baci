import { z } from 'zod';

export const hostedFundingEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    BACI_WORKER_PROFILE: z.literal('hosted-savings-funding'),
    PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED: z.literal('true'),
    PIGGYVEST_SAVINGS_FUNDING_API_SECRET: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_MERCHANT_ID: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_PROJECT_ID: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_FINGERPRINT_KEY: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_DB_HOST: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_DB_PORT: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_DB_NAME: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD: z.string().min(1),
    PIGGYVEST_SAVINGS_FUNDING_DB_CA: z.string().min(1),
  })
  .transform((value) => ({
    NODE_ENV: value.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: value.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_APP_URL: value.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: value.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    BACI_WORKER_PROFILE: value.BACI_WORKER_PROFILE,
  }));
