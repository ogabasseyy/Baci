import { describe, expect, it, vi } from 'vitest';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';

import { structuredCandidateTestSupport } from './structured-candidate-test-support';

const { setup, ranked, productRows } = structuredCandidateTestSupport;

describe('loadStructuredDiscoveryCandidates reciprocal-rank fusion', () => {
  it('fuses overlapping lexical and semantic candidates and hydrates in fusion order', async () => {
    const { supabase } = setup({
      lexicalPages: [ranked(['lexical-first', 'overlap', 'lexical-third'])],
      products: productRows(['lexical-third', 'semantic-only', 'overlap', 'lexical-first']),
    });
    const semanticSearch = vi.fn(async () => ['semantic-only', 'overlap']);

    const result = await loadStructuredDiscoveryCandidates({
      query: 'phone with good camera', merchantId: 'merchant-1', supabase, semanticSearch,
    });

    expect(result.products.map(({ id }) => id)).toEqual([
      'overlap', 'lexical-first', 'semantic-only', 'lexical-third',
    ]);
    expect(result).toMatchObject({ truncated: false, semanticUnavailable: false });
  });

  it('boosts lexical hits that also satisfy the structured facts', async () => {
    const fixture = setup({ lexicalPages: [ranked(['keyword-exact', 'semantic-match'])], products: productRows(['keyword-exact', 'semantic-match']) });
    const original = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation(async (name) => name === 'search_product_discovery_facts'
      ? { data: ranked(['keyword-exact']), error: null } : original(name));
    const result = await loadStructuredDiscoveryCandidates({ query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase,
      intent: { alternatives: [{ product_type: 'camera' }] }, factQuery: '(typecamera)',
      semanticSearch: async () => ['semantic-match'],
    });
    expect(result.products.map(({id}) => id)).toEqual(['keyword-exact', 'semantic-match']);
  });

  it('counts fallback-fact duplicates as one lexical vote on unconstrained browse', async () => {
    const fixture = setup({ lexicalPages: [ranked(['keyword-exact', 'semantic-match'])], products: productRows(['keyword-exact', 'semantic-match']) });
    const original = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation(async (name) => name === 'search_product_discovery_facts'
      ? { data: ranked(['keyword-exact']), error: null } : original(name));
    const result = await loadStructuredDiscoveryCandidates({ query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase,
      intent: { alternatives: [{}] },
      semanticSearch: async () => ['semantic-match'],
    });
    // The fact query falls back to the same free-text query, so the
    // lexical+facts duplicate must not outvote two independent evidences.
    expect(result.products.map(({id}) => id)).toEqual(['semantic-match', 'keyword-exact']);
  });
});
