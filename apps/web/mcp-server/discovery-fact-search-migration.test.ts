// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../../supabase/migrations/20260930210000_product_discovery_fact_search.sql', import.meta.url), 'utf8');

describe('verified fact search SQL contract', () => {
  it('keeps publication RLS authoritative and scopes retrieval to active merchant products', () => {
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).not.toContain('SECURITY DEFINER');
    expect(sql).toContain("p.merchant_id = merchant_id_param AND p.status = 'active'");
    expect(sql).toContain('SET search_path =');
    expect(sql).toContain('TO anon, authenticated');
  });
  it('indexes verified values and bounds result pagination with an authoritative count', () => {
    expect(sql).toContain('USING gin (jsonb_to_tsvector');
    expect(sql).toContain('["string", "numeric"]');
    expect(sql).toContain('count(*) OVER ()');
    expect(sql).toContain('ORDER BY p.id');
    expect(sql).toContain('left(query_text, 100)');
    expect(sql).toContain('result_offset, 0), 0), 500');
  });
});

const combinedSql = readFileSync(new URL('../../../supabase/migrations/20261001002000_combined_product_discovery_search.sql', import.meta.url), 'utf8');
describe('combined catalog/fact index contract', () => {
  it('uses the identical fixed-config document in the index and invoker RPC', () => {
    expect(combinedSql).toContain('LANGUAGE sql IMMUTABLE');
    expect(combinedSql).toContain('public.product_discovery_search_document(name, brand, category, description, discovery_metadata)');
    expect(combinedSql).toContain('public.product_discovery_search_document(p.name, p.brand, p.category,');
    expect(combinedSql).not.toContain('SECURITY DEFINER');
    expect(combinedSql).toContain("p.merchant_id = merchant_id_param AND p.status = 'active'");
  });
  it('builds the replacement concurrently before retiring the old index', () => {
    expect(combinedSql.startsWith('-- disable-transaction')).toBe(true);
    const build = combinedSql.indexOf('CREATE INDEX CONCURRENTLY products_discovery_combined_search_idx');
    const retire = combinedSql.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_fact_search_idx');
    expect(build).toBeGreaterThan(0);
    expect(retire).toBeGreaterThan(build);
  });
  it('derives retrieval unit lexemes only from canonical numeric facts', () => {
    expect(combinedSql).toContain("('storage_gb', 'GB')");
    expect(combinedSql).toContain("('power_w', 'W')");
    expect(combinedSql).toContain("jsonb_typeof(facts -> 'attributes' -> key) = 'number'");
    expect(combinedSql).toContain("value || ' ' || unit || ' ' || value || unit");
  });
});
