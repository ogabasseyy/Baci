import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260911100000_add_storefront_comparison_revisions.sql'
  ),
  'utf8'
);

describe('storefront comparison revisions migration contract', () => {
  it('creates an opaque merchant revision ledger that survives merchant deletion', () => {
    expect(migrationSql).toContain(
      'CREATE TABLE public.storefront_comparison_revisions'
    );
    expect(migrationSql).toContain('merchant_id uuid PRIMARY KEY');
    expect(migrationSql).toContain(
      'revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)'
    );
    expect(migrationSql).not.toContain('REFERENCES public.merchants');
    expect(migrationSql).toContain(
      'ON CONFLICT (merchant_id) DO UPDATE\n  SET revision = revision.revision + 1'
    );
  });

  it('exposes only a published-merchant scalar while denying ledger reads', () => {
    expect(migrationSql).toContain(
      'ALTER TABLE public.storefront_comparison_revisions ENABLE ROW LEVEL SECURITY;'
    );
    expect(migrationSql).toContain(
      'ALTER TABLE public.storefront_comparison_revisions FORCE ROW LEVEL SECURITY;'
    );
    expect(migrationSql).toContain(
      'REVOKE ALL ON TABLE public.storefront_comparison_revisions\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(migrationSql).toContain('AND merchant.is_published IS TRUE');
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_published_storefront_comparison_revision(uuid)\n  TO anon, authenticated;'
    );
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.get_published_storefront_comparison_revision(uuid)\n  FROM PUBLIC, service_role;'
    );
  });

  it('increments inside the existing cache-target transaction rather than using outbox generation', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.enqueue_storefront_cache_targets('
    );
    expect(migrationSql).toContain(
      'INSERT INTO public.storefront_comparison_revisions AS revision (merchant_id)'
    );
    expect(migrationSql).not.toContain(
      'max(outbox.generation)\n    INTO v_comparison_revision'
    );
  });
});
