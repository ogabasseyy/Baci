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
    expect(combinedSql).toContain('CREATE INDEX CONCURRENTLY products_discovery_combined_search_idx_new');
    expect(combinedSql).toContain('RENAME TO products_discovery_combined_search_idx;');
    expect(combinedSql).toContain("to_regclass('public.products_discovery_combined_search_idx') IS NULL");
    expect(combinedSql).toContain('i.indisvalid');
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
  expect(capacity).toContain('CREATE INDEX CONCURRENTLY products_discovery_capacity_search_idx_new');
  expect(capacity).toContain('RENAME TO products_discovery_capacity_search_idx;');
  expect(capacity).toContain("to_regclass('public.products_discovery_capacity_search_idx') IS NULL");
  expect(capacity).toContain('i.indisvalid');
});

it('indexes and queries numeric facts with their attribute identity', () => {
  const keyed = readFileSync(new URL('../../../supabase/migrations/20261001070000_keyed_discovery_numeric_facts.sql', import.meta.url), 'utf8');
  expect(keyed.startsWith('-- disable-transaction')).toBe(true);
  expect(keyed).toContain('product_discovery_search_document_v3');
  expect(keyed).toContain("('storage_gb', 'GB', 'storage')");
  expect(keyed).toContain("('ram_gb', 'GB', 'ram')");
  expect(keyed).toContain('attribute_prefix || value || unit');
  expect(keyed).toContain('jsonb_object_keys');
  expect(keyed).toContain('CREATE INDEX CONCURRENTLY products_discovery_keyed_search_idx_new');
  expect(keyed.indexOf('CREATE INDEX CONCURRENTLY products_discovery_keyed_search_idx_new'))
    .toBeLessThan(keyed.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(keyed.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx;'))
    .toBeGreaterThan(keyed.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(keyed).toContain('RENAME TO products_discovery_keyed_search_idx;');
  expect(keyed).toContain("to_regclass('public.products_discovery_keyed_search_idx') IS NULL");
  expect(keyed).toContain('i.indisvalid');
  expect(keyed).toContain('@@ pg_catalog.to_tsquery');
  expect(keyed).toContain('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_capacity_search_idx');
});

it('serves variant recall through a published-merchant RPC instead of the staff-only table', () => {
  const recall = readFileSync(new URL('../../../supabase/migrations/20261001093000_product_variant_recall_rpc.sql', import.meta.url), 'utf8');
  expect(recall).toContain('SECURITY DEFINER');
  expect(recall).toContain('is_published');
  expect(recall).toContain('is_inventory_anchor IS NOT TRUE');
  expect(recall).toContain("p.status = 'active'");
  expect(recall).toContain('TO anon, authenticated, service_role');
});

it('keeps the recall matchers in the helper migration under the size limit', () => {
  const helpers = readFileSync(new URL('../../../supabase/migrations/20261001090000_product_variant_recall.sql', import.meta.url), 'utf8');
  expect(helpers.split('\n').length).toBeLessThanOrEqual(300);
  expect(helpers).toContain('recall_variant_parse_numeric');
  expect(helpers).toContain('recall_variant_key_matches');
  expect(helpers).toContain('recall_variant_filter_verifiably_fails');
  expect(helpers).toContain('recall_variant_filter_exactly_matches');
  expect(helpers).toContain('recall_variant_filter_loader_accepts');
  expect(helpers).toContain('(ram[[:space:]');
  expect(helpers).toContain('pg_catalog.translate(');
  expect(helpers).not.toContain('pg_catalog.lower(');
  expect(helpers).not.toContain('search_product_variant_recall(');
});

it('filters variant recall by constraints before applying the cap', () => {
  const recall = readFileSync(new URL('../../../supabase/migrations/20261001093000_product_variant_recall_rpc.sql', import.meta.url), 'utf8');
  expect(recall.split('\n').length).toBeLessThanOrEqual(300);
  expect(recall).toContain('p_filters jsonb');
  expect(recall).toContain('recall_variant_filter_verifiably_fails');
  expect(recall).toContain('recall_variant_filter_exactly_matches');
  expect(recall).toContain('recall_variant_filter_loader_accepts');
  expect(recall).toContain('DISTINCT ON (eligible.product_id)');
  expect(recall).toContain('is_purchasable');
  expect(recall).toContain("policy.effective_policy = 'serialized_then_unlimited'");
  expect(recall).toContain("policy.effective_policy = 'serialized_strict'");
  expect(recall).toContain('COALESCE(units.available, 0) > 0');
  expect(recall).toContain('complete_branch_count');
  expect(recall).toContain('best_branch_exact');
  expect(recall.indexOf('(NOT best.is_purchasable)'))
    .toBeLessThan(recall.indexOf('best.complete_branch_count DESC'));
  expect(recall.indexOf('best.complete_branch_count DESC'))
    .toBeLessThan(recall.indexOf('best.best_branch_exact DESC'));
  expect(recall).not.toContain('is_exact');
  expect(recall).not.toContain('exact_count');
  // PostgREST clamps at 1,000 rows: the RPC pages below the cap, and the
  // superseded three-argument signature is dropped, never left stale.
  expect(recall).toContain('p_offset integer DEFAULT 0');
  expect(recall).toContain('OFFSET GREATEST(COALESCE(p_offset, 0), 0)');
  expect(recall).toContain(
    'DROP FUNCTION IF EXISTS public.search_product_variant_recall(uuid, jsonb, integer);'
  );
  expect(recall).toContain('jsonb_array_length(p_filters) > 50');
  expect(recall).toContain('octet_length(p_filters::text) > 16384');
  expect(recall.indexOf('recall_variant_filter_verifiably_fails(pv.attributes'))
    .toBeLessThan(recall.indexOf('LIMIT least'));
});

it('ranks variant recall by joint branch verdicts before attribute tiers', () => {
  const recall = readFileSync(new URL('../../../supabase/migrations/20261001150000_variant_recall_identity_rank.sql', import.meta.url), 'utf8');
  expect(recall.split('\n').length).toBeLessThanOrEqual(300);
  expect(recall).toContain(
    'DROP FUNCTION IF EXISTS public.search_product_variant_recall(uuid, jsonb, integer, integer);'
  );
  expect(recall).toContain("p_identity jsonb DEFAULT '[]'::jsonb");
  expect(recall).toContain("p_excluded_types jsonb DEFAULT '[]'::jsonb");
  expect(recall).toContain('p_brand text DEFAULT NULL');
  expect(recall).toContain('p_category text DEFAULT NULL');
  expect(recall).toContain('canonical_identity_product_type');
  expect(recall).toContain('discovery_identity_matcher_normalize');
  expect(recall).not.toContain('discovery_identity_normalize(');
  expect(recall).toContain('p.manage_stock IS FALSE');
  expect(recall).toContain('pg_catalog.translate(');
  expect(recall).not.toContain('pg_catalog.lower(');
  expect(recall).toContain('complete_alternative_count');
  expect(recall).toContain('clear_branch_count');
  expect(recall).toContain('identity_excluded');
  expect(recall).toContain('jsonb_array_length(p_identity) > 5');
  expect(recall).toContain('jsonb_array_length(p_excluded_types) > 10');
  expect(recall.lastIndexOf('(NOT best.is_purchasable)'))
    .toBeLessThan(recall.lastIndexOf('best.identity_excluded'));
  expect(recall.lastIndexOf('best.identity_excluded'))
    .toBeLessThan(recall.lastIndexOf('best.complete_alternative_count DESC'));
  expect(recall.lastIndexOf('best.clear_branch_count DESC'))
    .toBeLessThan(recall.lastIndexOf('best.complete_branch_count DESC'));
});

it('measures product-type length on the canonicalized SQL value', () => {
  const length = readFileSync(new URL('../../../supabase/migrations/20261001160000_canonical_product_type_length.sql', import.meta.url), 'utf8');
  expect(length.split('\n').length).toBeLessThanOrEqual(300);
  expect(length).toContain(
    'DROP FUNCTION IF EXISTS discovery.canonical_identity_product_type(text, text);'
  );
  expect(length).toContain(
    'CREATE OR REPLACE FUNCTION discovery.product_discovery_metadata_valid(facts jsonb)'
  );
  expect(length).toContain(
    'canonical_identity_product_type(facts ->> top_key, NULL)'
  );
  expect(length).toContain('pg_catalog.translate(');
  expect(length).not.toContain('pg_catalog.lower(');
});

it('moves index builders out of the exposed schema without changing the serving contract', () => {
  const move = readFileSync(new URL('../../../supabase/migrations/20261001100000_move_discovery_builders.sql', import.meta.url), 'utf8');
  expect(move.startsWith('-- disable-transaction')).toBe(true);
  expect(move).toContain('CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v3(');
  expect(move).toContain('CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v4(');
  expect(move).toContain('discovery.product_discovery_search_document_v4');
  expect(move).toContain('USAGE ON SCHEMA discovery TO anon, authenticated, service_role');
  expect(move).toContain('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(');
  expect(move).toContain('SECURITY INVOKER');
  expect(move).toContain('pg_catalog.translate(');
  expect(move).not.toContain('pg_catalog.lower(');
});

it('stages the builder move so a mid-migration failure stays retry-safe', () => {
  const move = readFileSync(new URL('../../../supabase/migrations/20261001100000_move_discovery_builders.sql', import.meta.url), 'utf8');
  const copyV3 = move.indexOf('CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v3(');
  const copyV4 = move.indexOf('CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v4(');
  const buildReplacement = move.indexOf('CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx_new');
  expect(move).toContain("to_regclass('public.products_discovery_correlated_search_idx') IS NULL");
  expect(move).toContain('i.indisvalid');
  const switchRpc = move.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(');
  const dropServingIndex = move.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;');
  const promoteOnRetry = move.indexOf('RENAME TO products_discovery_correlated_search_idx;');
  const renameReplacement = move.indexOf('RENAME TO products_discovery_correlated_search_idx;', dropServingIndex);
  const dropV4 = move.indexOf('DROP FUNCTION IF EXISTS public.product_discovery_search_document_v4(');
  const dropV3 = move.indexOf('DROP FUNCTION IF EXISTS public.product_discovery_search_document_v3(');
  // Copy-first: both discovery copies exist before the serving index or RPC switches.
  expect(copyV3).toBeGreaterThanOrEqual(0);
  expect(copyV4).toBeGreaterThan(copyV3);
  expect(buildReplacement).toBeGreaterThan(copyV4);
  // Build-before-drop: the replacement index finishes before the RPC
  // switches, and the serving index drops only after the switch.
  // Retry-then-build: a valid staged replacement promotes before the rebuild.
  expect(promoteOnRetry).toBeGreaterThanOrEqual(0);
  expect(promoteOnRetry).toBeLessThan(buildReplacement);
  // Stale-canonical retry: when the canonical name still serves the old
  // public.v4 expression, a valid replacement parks the stale index aside
  // and promotes instead of being dropped for a redundant rebuild.
  expect(move).toContain('pg_depend');
  expect(move).toContain(
    "to_regprocedure('public.product_discovery_search_document_v4(text, text, text, text, jsonb)')"
  );
  expect(move).toContain(
    'RENAME TO products_discovery_correlated_search_idx_stale;'
  );
  const dropStale = move.indexOf(
    'DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx_stale;'
  );
  expect(dropStale).toBeGreaterThanOrEqual(0);
  expect(dropStale).toBeLessThan(buildReplacement);
  expect(switchRpc).toBeGreaterThan(buildReplacement);
  expect(dropServingIndex).toBeGreaterThan(switchRpc);
  expect(renameReplacement).toBeGreaterThan(dropServingIndex);
  // Switch-then-remove: the serving contract moves before the public originals drop.
  expect(dropV4).toBeGreaterThan(renameReplacement);
  expect(dropV3).toBeGreaterThan(dropV4);
  // Only the non-serving v1/v2 builders may move via SET SCHEMA; the
  // serving v3/v4 builders move through copy-first staging.
  const setSchemaLines = move
    .split('\n')
    .filter((line) => line.includes('SET SCHEMA'));
  expect(setSchemaLines).toHaveLength(2);
  for (const line of setSchemaLines) {
    expect(line).toMatch(
      /ALTER FUNCTION public\.product_discovery_search_document(_v2)?\(/
    );
  }
});

it('indexes key-specific identity lexemes for capped retrieval', () => {
  const identity = readFileSync(new URL('../../../supabase/migrations/20261001110000_keyed_discovery_identity_facts.sql', import.meta.url), 'utf8');
  expect(identity.startsWith('-- disable-transaction')).toBe(true);
  expect(identity).toContain('product_discovery_search_document_v5');
  expect(identity).toContain('discovery.discovery_identity_lexeme');
  expect(identity).toContain('discovery.discovery_identity_matcher_normalize');
  expect(identity).toContain("tag IN ('brand', 'model', 'compat')");
  expect(identity).toContain('pg_catalog.translate(');
  expect(identity).not.toContain('pg_catalog.lower(');
  expect(identity).toContain("'fact' || pg_catalog.encode(extensions.digest");
  expect(identity).toContain("tag || pg_catalog.chr(31) || normalized");
  expect(identity).toContain('CREATE INDEX CONCURRENTLY products_discovery_identity_search_idx_new');
  expect(identity.indexOf('CREATE INDEX CONCURRENTLY products_discovery_identity_search_idx_new'))
    .toBeLessThan(identity.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(identity.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;'))
    .toBeGreaterThan(identity.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(identity).toContain('RENAME TO products_discovery_identity_search_idx;');
  expect(identity).toContain("to_regclass('public.products_discovery_identity_search_idx') IS NULL");
  expect(identity).toContain('i.indisvalid');
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
  expect(correlated).toContain('CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx_new');
  expect(correlated.indexOf('CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx_new'))
    .toBeLessThan(correlated.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(correlated.indexOf('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;'))
    .toBeGreaterThan(correlated.indexOf('CREATE OR REPLACE FUNCTION public.search_product_discovery_facts('));
  expect(correlated).toContain('RENAME TO products_discovery_correlated_search_idx;');
  expect(correlated).toContain("to_regclass('public.products_discovery_correlated_search_idx') IS NULL");
  expect(correlated).toContain('i.indisvalid');
  expect(correlated).toContain('SECURITY INVOKER');
  expect(correlated).toContain('DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx');
});
