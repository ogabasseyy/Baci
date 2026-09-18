import { logger } from '@/lib/logger';
import type { MerchantSupabaseClient } from './merchant-supabase-client';
import { fetchMerchantBySlug, fetchPrimaryDomain } from './queries';
import type { MerchantData } from './types';

interface LoadBySlugArgs {
  supabase: MerchantSupabaseClient;
  slug: string;
  isCancelled: () => boolean;
  setMerchant: (merchant: MerchantData | null) => void;
  setLoading: (loading: boolean) => void;
}

// Module scope keeps try/finally out of the React Compiler-lowered provider.
export async function loadMerchantBySlug({
  supabase,
  slug,
  isCancelled,
  setMerchant,
  setLoading,
}: LoadBySlugArgs): Promise<void> {
  try {
    const data = await fetchMerchantBySlug(supabase, slug);
    if (isCancelled()) return;

    if (data?.id) {
      const domain = await fetchPrimaryDomain(supabase, data.id);
      if (!isCancelled() && domain) data.custom_domain = domain;
    }

    if (!isCancelled()) setMerchant(data);
  } catch (error) {
    logger.error({
      message: `Failed to load merchant by slug: ${slug}. Error: ${(error as Error).message}`,
    });
    if (!isCancelled()) setMerchant(null);
  } finally {
    if (!isCancelled()) setLoading(false);
  }
}

interface ReloadBySlugArgs {
  getSupabase: () => Promise<MerchantSupabaseClient>;
  slug: string;
  setMerchant: (merchant: MerchantData | null) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Re-fetch a slug-routed merchant (manual reload action). Always settles
 * loading — including when the lazy client itself fails to load.
 */
export async function reloadMerchantBySlug({
  getSupabase,
  slug,
  setMerchant,
  setLoading,
}: ReloadBySlugArgs): Promise<void> {
  try {
    const supabase = await getSupabase();
    const data = await fetchMerchantBySlug(supabase, slug);
    if (data?.id) {
      const domain = await fetchPrimaryDomain(supabase, data.id);
      if (domain) data.custom_domain = domain;
    }
    setMerchant(data);
  } catch (error) {
    logger.error({
      message: `Reload failed: ${(error as Error).message}`,
    });
  } finally {
    setLoading(false);
  }
}
