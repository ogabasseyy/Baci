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
