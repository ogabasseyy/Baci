// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('gates condition offers on active status and axis ownership', () => {
  const gate = readFileSync(new URL('../../../supabase/migrations/20261001200000_condition_offer_selectable.sql', import.meta.url), 'utf8');
  expect(gate.split('\n').length).toBeLessThanOrEqual(300);
  expect(gate).toContain('CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(');
  expect(gate).toContain("o.status = 'active'");
  expect(gate).toContain('v2.is_inventory_anchor IS NOT TRUE');
  expect(gate).toContain('discovery.canonical_product_condition(v2.condition) IS NOT NULL');
});

it('canonicalizes the requested recall condition before comparing', () => {
  const recall = readFileSync(new URL('../../../supabase/migrations/20261001210000_variant_recall_condition_gate.sql', import.meta.url), 'utf8');
  expect(recall.split('\n').length).toBeLessThanOrEqual(300);
  expect(recall).toContain('CREATE OR REPLACE FUNCTION public.search_product_variant_recall(');
  expect(recall).not.toContain('DROP FUNCTION IF EXISTS public.search_product_variant_recall(');
  expect(recall).toContain('discovery.canonical_product_condition(p_condition) AS condition');
  expect(recall).toContain('requested.condition IS NULL');
  expect(recall).toContain('discovery.condition_offer_selectable(p.id, p.has_variants, requested.condition)');
  expect(recall).not.toContain('NULLIF(p_condition');
});

it('narrows fact retrieval by condition before the ranking cap', () => {
  const facts = readFileSync(new URL('../../../supabase/migrations/20261001230000_fact_condition_narrowing.sql', import.meta.url), 'utf8');
  expect(facts.split('\n').length).toBeLessThanOrEqual(300);
  expect(facts).toContain(
    'DROP FUNCTION IF EXISTS public.search_product_discovery_facts(uuid, text, integer, integer, text, text);'
  );
  expect(facts).toContain('condition_filter text DEFAULT NULL');
  expect(facts).toContain('LANGUAGE sql STABLE SECURITY INVOKER');
  expect(facts).toContain('CREATE OR REPLACE FUNCTION discovery.product_condition_option_matches(');
  expect(facts).toContain('LANGUAGE sql STABLE SECURITY DEFINER');
  expect(facts).toContain('discovery.condition_offer_selectable(p_product_id, p_has_variants, p_condition)');
  expect(facts).not.toContain('pg_catalog.lower(');
});

it('narrows browse by condition before paging with nulls last', () => {
  const browse = readFileSync(new URL('../../../supabase/migrations/20261001220000_browse_condition_narrowing.sql', import.meta.url), 'utf8');
  expect(browse.split('\n').length).toBeLessThanOrEqual(300);
  expect(browse).toContain(
    'DROP FUNCTION IF EXISTS public.search_products_browse(uuid, text, text, text, integer, integer);'
  );
  expect(browse).toContain('p_condition text DEFAULT NULL');
  expect(browse).toContain('discovery.condition_offer_selectable(p.id, p.has_variants, requested.condition)');
  expect(browse).toContain('END DESC NULLS LAST');
  expect(browse).not.toContain('pg_catalog.lower(');
});
