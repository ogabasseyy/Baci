import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { embedDiscoveryText } from './gemini-discovery-embedding';

type ProductRow = {
  id: string;
  merchant_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
};

function isMerchantUserToken(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as unknown;
    return typeof payload === 'object' && payload !== null &&
      'role' in payload && payload.role === 'authenticated' &&
      'sub' in payload && typeof payload.sub === 'string';
  } catch {
    return false;
  }
}

/** Merchant-authenticated, resumable backfill. Never accepts a service-role key. */
export async function backfillDiscoveryEmbeddings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const merchantId = process.env.MERCHANT_ID;
  if (!url || !anonKey || !accessToken || !geminiKey || !merchantId) {
    throw new Error('Provide Supabase URL, anon key, merchant access token, Gemini key, and merchant ID');
  }
  if (!isMerchantUserToken(accessToken)) {
    throw new Error('SUPABASE_ACCESS_TOKEN must be a merchant user JWT');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(merchantId)) {
    throw new Error('MERCHANT_ID must be a UUID');
  }
  const requestedLimit = Number(process.env.MAX_PRODUCTS || 50);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error('MAX_PRODUCTS must be a positive integer');
  }
  const maxProducts = Math.min(requestedLimit, 5000);
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let processed = 0;
  let offset = 0;
  while (processed < maxProducts) {
    const { data, error } = await client.from('products')
      .select('id, merchant_id, name, brand, category, description')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + 49);
    if (error) throw new Error(`Catalog read failed: ${error.code}`);
    const products = (data ?? []) as ProductRow[];
    if (products.length === 0) break;
    const { data: priorRows, error: priorError } = await client
      .from('product_discovery_embeddings')
      .select('product_id, source_hash')
      .in('product_id', products.map((product) => product.id));
    if (priorError) throw new Error(`Embedding state read failed: ${priorError.code}`);
    const priorHashes = new Map((priorRows ?? []).map((row) => [row.product_id, row.source_hash]));
    for (const product of products) {
      const sourceHash = createHash('sha256').update(JSON.stringify([
        product.name, product.brand, product.category, product.description,
      ])).digest('hex');
      if (priorHashes.get(product.id) === sourceHash) continue;
      const text = [product.brand, product.category, product.description]
        .filter((part): part is string => typeof part === 'string')
        .join('. ').replace(/<[^>]{0,2000}>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
      const embedding = await embedDiscoveryText({
        apiKey: geminiKey, kind: 'document', title: product.name,
        text: text.trim() || product.name,
      });
      const { error: writeError } = await client.from('product_discovery_embeddings')
        .upsert({
          product_id: product.id,
          merchant_id: product.merchant_id,
          embedding: JSON.stringify(embedding),
          source_hash: sourceHash,
          model: 'gemini-embedding-2',
          generated_at: new Date().toISOString(),
        });
      if (writeError) throw new Error(`Embedding write failed: ${writeError.code}`);
      processed += 1;
      if (processed >= maxProducts) break;
    }
    offset += products.length;
    if (products.length < 50) break;
  }
  console.log(`Generated ${processed} product discovery embeddings`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillDiscoveryEmbeddings().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Embedding backfill failed');
    process.exitCode = 1;
  });
}
