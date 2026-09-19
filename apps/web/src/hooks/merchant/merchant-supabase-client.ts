import type { createClient } from '@/lib/supabase/client';

export type MerchantSupabaseClient = ReturnType<typeof createClient>;

// Module scope: React Compiler cannot lower dynamic import() inside the
// provider. Lazy so the generic branch's static supabase edge (which every
// storefront page ships via the server-awaited page.tsx branch union) becomes
// load-on-first-merchant-fetch instead.
async function loadSupabaseClient(): Promise<MerchantSupabaseClient> {
  const { createClient } = await import('@/lib/supabase/client');
  return createClient();
}

let supabaseClientPromise: Promise<MerchantSupabaseClient> | null = null;

/**
 * Sole export: process-wide cached browser client for merchant data
 * fetching. Stable across renders (no exhaustive-deps churn); every
 * caller shares the first resolution.
 *
 * Self-healing: a rejected import/factory drops the cached promise so the
 * failure does not poison every future caller for the page lifetime — the
 * next call re-imports. Callers still observe (and must handle) the original
 * rejection; this only clears the cache fork.
 *
 * `reset` is the test seam (drop the cached client so tests isolate
 * resolutions), kept as a method so the module exposes a single cache
 * abstraction.
 */
export const merchantSupabaseClientCache = {
  get(): Promise<MerchantSupabaseClient> {
    if (!supabaseClientPromise) {
      const pending = loadSupabaseClient();
      supabaseClientPromise = pending;
      void pending.catch(() => {
        if (supabaseClientPromise === pending) {
          supabaseClientPromise = null;
        }
      });
    }
    return supabaseClientPromise;
  },

  reset(): void {
    supabaseClientPromise = null;
  },
};
