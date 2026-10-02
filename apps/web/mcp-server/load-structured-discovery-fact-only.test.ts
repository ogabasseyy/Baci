import { expect, it } from 'vitest';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';
import { structuredCandidateTestSupport } from './structured-candidate-test-support';

const { setup, ranked, productRows } = structuredCandidateTestSupport;
it('retrieves an indexed metadata-only model outside the browse window without shopper query text', async () => {
  const rows = productRows(Array.from({length: 501}, (_, i) => `p-${i}`));
  const fixture = setup({lexicalPages: [], products: rows});
  fixture.rpc.mockImplementation(async (name) => ({data: name === 'search_product_discovery_facts' ? ranked(['p-500']) : [], error: null}));
  const result = await loadStructuredDiscoveryCandidates({factQuery: '(zx42)', merchantId: 'merchant-1', supabase: fixture.supabase});
  expect(result.products.map(({id}) => id)).toEqual(['p-500']);
  expect(result.truncated).toBe(false);
  expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', expect.objectContaining({query_text: '(zx42)'}));
  expect(fixture.queryCalls[0]?.calls).toContainEqual(['in', 'id', ['p-500']]);
  expect(fixture.queryCalls[0]?.calls.some(([method]) => method === 'range')).toBe(false);
});
