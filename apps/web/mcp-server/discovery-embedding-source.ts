import { createHash } from 'node:crypto';

type DiscoveryProduct = {
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
};

/** Keep both backfill paths aligned with the search RPC's source hash. */
export function discoveryEmbeddingSource(product: DiscoveryProduct) {
  const sourceHash = createHash('sha256').update(JSON.stringify([
    product.name, product.brand, product.category, product.description,
  ])).digest('hex');
  const text = [product.brand, product.category, product.description]
    .filter((part): part is string => typeof part === 'string')
    .join('. ').replace(/<[^>]{0,2000}>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
  return { sourceHash, text: text.trim() || product.name };
}
