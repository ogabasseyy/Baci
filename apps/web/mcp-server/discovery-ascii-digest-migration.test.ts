// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const asciiDigestSql = readFileSync(new URL('../../../supabase/migrations/20261002090730_ascii_discovery_attribute_digest.sql', import.meta.url), 'utf8');
describe('ASCII-safe discovery attribute digest migration', () => {
  it('removes v4 text digests and preserves exact identity retrieval', () => {
    expect(asciiDigestSql.split('\n').length).toBeLessThanOrEqual(300);
    expect(asciiDigestSql).toContain('discovery.product_discovery_search_document_v3(');
    expect(asciiDigestSql).toContain('discovery.discovery_identity_matcher_normalize(');
    expect(asciiDigestSql).toContain('discovery.discovery_identity_lexeme_v6(\'type\'');
    expect(asciiDigestSql).not.toContain('product_discovery_search_document_v5(');
    expect(asciiDigestSql).not.toContain('pg_catalog.lower(');
  });
  it('builds v6 before switching the full fact RPC and retiring the old index', () => {
    const build = asciiDigestSql.indexOf('CREATE INDEX CONCURRENTLY products_discovery_ascii_search_idx_new');
    const switchRpc = asciiDigestSql.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(');
    const retire = asciiDigestSql.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;');
    expect(build).toBeGreaterThanOrEqual(0);
    expect(switchRpc).toBeGreaterThan(build);
    expect(retire).toBeGreaterThan(switchRpc);
    expect(asciiDigestSql).toContain('condition_filter text DEFAULT NULL');
    expect(asciiDigestSql).toContain('excluded_types_filter jsonb DEFAULT');
    expect(asciiDigestSql).toContain('TO anon, authenticated');
    expect(asciiDigestSql).toContain('rpc_serves_v6 boolean');
    expect(asciiDigestSql).toContain('products_discovery_identity_search_idx_stale');
    expect(asciiDigestSql).toContain('discovery_identity_lexeme_v6(text, text) FROM PUBLIC');
  });
});
