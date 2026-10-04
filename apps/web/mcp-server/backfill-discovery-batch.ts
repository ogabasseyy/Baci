import type { SupabaseClient } from '@supabase/supabase-js';
import { discoveryEmbeddingSource } from './discovery-embedding-source';
import { embedDiscoveryText } from './gemini-discovery-embedding';

const BATCH_SIZE = 5;

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
};

/** One small, idempotent page under the caller's merchant session and RLS. */
export async function backfillDiscoveryBatch({
  supabase, merchantId, cursor, geminiKey, embed = embedDiscoveryText,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  cursor: string | null;
  geminiKey: string;
  embed?: typeof embedDiscoveryText;
}) {
  let query = supabase.from('products')
    .select('id, name, brand, category, description')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('id')
    .limit(BATCH_SIZE);
  if (cursor) query = query.gt('id', cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Catalog read failed: ${error.code}`);
  const products = (data ?? []) as ProductRow[];
  if (products.length === 0) {
    return { scanned: 0, generated: 0, nextCursor: cursor, done: true };
  }

  const { data: priorRows, error: priorError } = await supabase
    .from('product_discovery_embeddings')
    .select('product_id, source_hash')
    .eq('merchant_id', merchantId)
    .in('product_id', products.map((product) => product.id));
  if (priorError) throw new Error(`Embedding state read failed: ${priorError.code}`);
  const priorHashes = new Map((priorRows ?? []).map((row) => [row.product_id, row.source_hash]));

  let generated = 0;
  for (const product of products) {
    const { sourceHash, text } = discoveryEmbeddingSource(product);
    if (priorHashes.get(product.id) === sourceHash) continue;
    const embedding = await embed({
      apiKey: geminiKey, kind: 'document', title: product.name, text,
    });
    const { error: writeError } = await supabase.from('product_discovery_embeddings')
      .upsert({
        product_id: product.id,
        merchant_id: merchantId,
        embedding: JSON.stringify(embedding),
        source_hash: sourceHash,
        model: 'gemini-embedding-2',
        generated_at: new Date().toISOString(),
      });
    if (writeError) throw new Error(`Embedding write failed: ${writeError.code}`);
    generated += 1;
  }
  return {
    scanned: products.length,
    generated,
    nextCursor: products.at(-1)?.id ?? cursor,
    done: products.length < BATCH_SIZE,
  };
}
