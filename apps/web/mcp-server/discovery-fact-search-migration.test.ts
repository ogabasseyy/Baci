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

it('prebuilds the transient index concurrently and supports equivalent capacity units additively', () => {
  const prebuild = readFileSync(new URL('../../../supabase/migrations/20260930205900_prebuild_product_discovery_fact_index.sql', import.meta.url), 'utf8');
  const capacity = readFileSync(new URL('../../../supabase/migrations/20261001061000_equivalent_discovery_capacity_units.sql', import.meta.url), 'utf8');
  expect(prebuild).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS products_discovery_fact_search_idx');
  expect(capacity).toContain('numeric / 1024');
  expect(capacity).toContain('numeric * 1024');
  expect(capacity).toContain('product_discovery_search_document_v2');
});

it('indexes and queries numeric facts with their attribute identity', () => {
  const keyed = readFileSync(new URL('../../../supabase/migrations/20261001070000_keyed_discovery_numeric_facts.sql', import.meta.url), 'utf8');
  expect(keyed.startsWith('-- disable-transaction')).toBe(true);
  expect(keyed).toContain('product_discovery_search_document_v3');
  expect(keyed).toContain("('storage_gb', 'GB', 'storage')");
  expect(keyed).toContain("('ram_gb', 'GB', 'ram')");
  expect(keyed).toContain('attribute_prefix || value || unit');
  expect(keyed).toContain('jsonb_object_keys');
  expect(keyed).toContain('CREATE INDEX CONCURRENTLY products_discovery_keyed_search_idx');
  expect(keyed.indexOf('CREATE INDEX CONCURRENTLY products_discovery_keyed_search_idx'))
    .toBeLessThan(keyed.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(keyed).toContain('@@ pg_catalog.to_tsquery');
  expect(keyed).toContain('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_capacity_search_idx');
});

it('serves variant recall through a published-merchant RPC instead of the staff-only table', () => {
  const recall = readFileSync(new URL('../../../supabase/migrations/20261001090000_product_variant_recall.sql', import.meta.url), 'utf8');
  expect(recall).toContain('SECURITY DEFINER');
  expect(recall).toContain('is_published');
  expect(recall).toContain('is_inventory_anchor IS NOT TRUE');
  expect(recall).toContain("p.status = 'active'");
  expect(recall).toContain('TO anon, authenticated, service_role');
});

it('moves index builders out of the exposed schema without changing the serving contract', () => {
  const move = readFileSync(new URL('../../../supabase/migrations/20261001100000_move_discovery_builders_private.sql', import.meta.url), 'utf8');
  expect(move.startsWith('-- disable-transaction')).toBe(true);
  expect(move).toContain('SET SCHEMA private');
  expect(move).toContain('private.product_discovery_search_document_v4');
  expect(move).toContain('USAGE ON SCHEMA private TO anon, authenticated');
  expect(move).toContain('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(');
  expect(move).toContain('SECURITY INVOKER');
});

it('indexes key-specific identity lexemes for capped retrieval', () => {
  const identity = readFileSync(new URL('../../../supabase/migrations/20261001110000_keyed_discovery_identity_facts.sql', import.meta.url), 'utf8');
  expect(identity.startsWith('-- disable-transaction')).toBe(true);
  expect(identity).toContain('product_discovery_search_document_v5');
  expect(identity).toContain("'type' ||");
  expect(identity).toContain("'brand' ||");
  expect(identity).toContain("'model' ||");
  expect(identity).toContain('private.discovery_identity_key');
  expect(identity).toContain('CREATE INDEX CONCURRENTLY products_discovery_identity_search_idx');
  expect(identity).toContain('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx');
});

it('indexes correlated verified text attribute pairs after the concurrent replacement build', () => {
  const correlated = readFileSync(new URL('../../../supabase/migrations/20261001080000_correlated_text_attribute_search.sql', import.meta.url), 'utf8');
  expect(correlated.startsWith('-- disable-transaction')).toBe(true);
  expect(correlated).toContain('product_discovery_search_document_v3');
  expect(correlated).toContain('pg_catalog.encode');
  expect(correlated).toContain('extensions.digest');
  expect(correlated).toContain("pg_catalog.convert_to(pair.key || pg_catalog.chr(31) || pair.normalized_value, 'UTF8')");
  expect(correlated).toContain("attribute.key IN ('color', 'connector', 'processor', 'connectivity')");
  expect(correlated).toContain("pg_catalog.jsonb_typeof(attribute.value) = 'string'");
  expect(correlated).toContain('pg_catalog.normalize(attribute.value #>>');
  expect(correlated).toContain('NFC');
  expect(correlated).toContain('pg_catalog.chr(31)');
  expect(correlated).toContain('CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx');
  expect(correlated.indexOf('CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx'))
    .toBeLessThan(correlated.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(correlated).toContain('SECURITY INVOKER');
  expect(correlated).toContain('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx');
});
