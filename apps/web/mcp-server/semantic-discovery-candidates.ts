import type { SupabaseClient } from '@supabase/supabase-js';
import { embedDiscoveryText } from './gemini-discovery-embedding';

type SemanticRow = { product_id?: unknown; similarity?: unknown };

/** Semantic candidates are only considered after lexical retrieval and still
 * pass catalog visibility, category, condition, option-price and stock checks. */
export async function loadSemanticDiscoveryCandidateIds({
  apiKey,
  fetchImpl,
  merchantId,
  query,
  supabase,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  merchantId: string;
  query: string;
  supabase: SupabaseClient;
}): Promise<string[]> {
  const vector = await embedDiscoveryText({ apiKey, fetchImpl, kind: 'query', text: query });
  const { data, error } = await supabase.rpc('search_product_discovery_embeddings', {
    query_embedding: JSON.stringify(vector),
    merchant_id_param: merchantId,
    result_limit: 40,
  });
  if (error) throw error;
  return ((data ?? []) as SemanticRow[])
    .filter((row): row is { product_id: string; similarity: number } =>
      typeof row.product_id === 'string' &&
      typeof row.similarity === 'number' && row.similarity >= 0.65)
    .map((row) => row.product_id);
}
