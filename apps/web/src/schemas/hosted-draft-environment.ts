import { z } from 'zod';

export const hostedDraftEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    BACI_WORKER_PROFILE: z.literal('hosted-savings-drafts'),
    PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED: z.literal('true'),
  })
  .transform((value) => ({
    NODE_ENV: value.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: value.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_APP_URL: value.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: value.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    BACI_WORKER_PROFILE: value.BACI_WORKER_PROFILE,
  }));
