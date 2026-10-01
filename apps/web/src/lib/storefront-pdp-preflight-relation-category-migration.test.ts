import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  import.meta.dirname,
  '../../../..',
  'supabase/migrations/20260814124135_fix_storefront_pdp_preflight_relation_category.sql'
);

describe('storefront PDP preflight relation-category migration', () => {
  it('keeps active junction categories in parity with the PDP canonical path', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain(
      'ALTER FUNCTION public.get_storefront_pdp_preflight(text, text)\n  SET SCHEMA private'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_storefront_pdp_preflight'
    );
    expect(sql).toContain('FROM public.product_categories AS membership');
    expect(sql).toContain('JOIN public.products AS relation_product');
    expect(sql).toContain('JOIN public.categories AS joined_category');
    expect(sql).toContain('joined_category.is_active IS TRUE');
    expect(sql).toContain(
      'joined_category.merchant_id = relation_product.merchant_id'
    );
    expect(sql).toContain('COALESCE(base.category_id, relation_category.id)');
    expect(sql).toContain(
      'COALESCE(base.category_name, relation_category.name)'
    );
    expect(sql).toContain(
      'COALESCE(base.category_slug, relation_category.slug)'
    );
    expect(sql).toContain('ORDER BY membership.category_id');
    expect(sql).toContain("SECURITY DEFINER\nSET search_path TO ''");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_storefront_pdp_preflight(text, text)\n  TO anon, authenticated, service_role'
    );
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});
