import { logger } from '@/lib/logger';
import { createAnonClient } from '@/lib/supabase/anon';
import { crossRemCatalogConfig } from './catalog-bindings';

export async function readCrossRemCatalogVersion(): Promise<string> {
  const { merchantId, bindings } = crossRemCatalogConfig;
  if (!merchantId || bindings.length === 0) {
    throw new Error('CrossRem catalog is unconfigured');
  }

  const { data, error } = await createAnonClient()
    .from('crossrem_catalog_generations')
    .select('revision')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) {
    throw new Error('CrossRem catalog version unavailable', { cause: error });
  }
  if (typeof data?.revision !== 'string') {
    logger.warn({
      message: 'CrossRem catalog enrollment or feed eligibility missing',
    });
    throw new Error('CrossRem catalog version unavailable');
  }
  return data.revision;
}
