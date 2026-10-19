// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

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
