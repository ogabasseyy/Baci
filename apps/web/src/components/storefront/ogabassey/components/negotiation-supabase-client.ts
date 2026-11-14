import type { createClient } from '@/lib/supabase/client';

// Keep the Supabase client out of the initial storefront bundle.
export async function loadNegotiationSupabaseClient(): Promise<
  ReturnType<typeof createClient>
> {
  const { createClient } = await import('@/lib/supabase/client');
  return createClient();
}
