import { describe, expect, it } from 'vitest';
import { discoverStructuredProducts } from './discover-structured-products';

import { discoverStructuredProductsTestSupport } from './discover-structured-products-test-support';

const { client, product, intent, input } = discoverStructuredProductsTestSupport;

describe('discoverStructuredProducts fact queries', () => {
  it('returns fact-source matches with incomplete price coverage when lexical retrieval fails', async () => {
    const row = product('facts-only', {product_type: 'laptop', model: 'ZX-42'});
    const fixture = client({products: [row], factIds: ['facts-only'], lexicalError: new Error('lexical offline')});
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({product_type: 'laptop', model: 'ZX-42'}), {query: 'ZX-42', args: {sort: 'price_asc'}}));
    expect(result.selectedProducts.map(({product}) => product.id)).toEqual(['facts-only']);
    expect(result.coverage).toBe('partial');
    expect(result.priceScanComplete).toBe(false);
  });

  it('selects a verified model retrieved only from the facts index', async () => {
    const row = product('generic-item', {product_type: 'laptop', model: 'ZX-42'});
    const fixture = client({products: [row], lexicalIds: [], factIds: ['generic-item']});
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({product_type: 'laptop', model: 'ZX-42'}), {query: 'ZX-42'}));
    expect(result.selectedProducts.map(({product}) => product.id)).toEqual(['generic-item']);
    expect(result.coverage).toBe('complete');
  });

  it('queries the facts index from structured alternatives rather than shopper wording', async () => {
    const fixture = client({ products: [product('holdout', { product_type: 'phone' })] });
    await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'phone', brands: ['Samsung', 'Google'], attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }),
      { query: 'Samsung or Google 256GB under budget' }));
    expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', expect.objectContaining({
      query_text: '(typephone & (brandsamsung | brandgoogle) & storage256gb)',
    }));
  });
});
