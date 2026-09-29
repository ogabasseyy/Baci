import type { SupabaseClient } from '@supabase/supabase-js';

type SemanticRow = { product_id?: unknown; similarity?: unknown };

/** Semantic candidates are only considered after lexical retrieval and still
 * pass catalog visibility, category, condition, option-price and stock checks. */
export async function loadSemanticDiscoveryCandidateIds({
  embedding,
  merchantId,
  offset = 0,
  supabase,
}: {
  embedding: number[];
  merchantId: string;
  offset?: number;
  supabase: SupabaseClient;
}): Promise<string[]> {
  const { data, error } = await supabase.rpc('search_product_discovery_embeddings', {
    query_embedding: JSON.stringify(embedding),
    merchant_id_param: merchantId,
    result_limit: 40,
    result_offset: offset,
  });
  if (error) throw error;
  return ((data ?? []) as SemanticRow[])
    .filter((row): row is { product_id: string; similarity: number } =>
      typeof row.product_id === 'string' &&
      typeof row.similarity === 'number' && row.similarity >= 0.65)
    .map((row) => row.product_id);
}
