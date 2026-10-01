import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../../../supabase/migrations/20260831100000_harden_jumia_product_mappings_staff_writes.sql'
  ),
  'utf8'
);

describe('Jumia product mapping staff-write hardening migration', () => {
  it('replaces the broad policy with a read policy for active staff', () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS jumia_product_mappings_merchant_policy'
    );
    expect(migration).toMatch(
      /CREATE POLICY jumia_product_mappings_select_policy[\s\S]*?FOR SELECT[\s\S]*?staff_members\.status = 'active'/
    );
    expect(migration).not.toMatch(
      /CREATE POLICY jumia_product_mappings_merchant_policy/
    );
  });

  it('requires integrations.manage for staff inserts, updates, and deletes', () => {
    expect(migration).toMatch(
      /CREATE POLICY jumia_product_mappings_insert_policy[\s\S]*?FOR INSERT[\s\S]*?'integrations',[\s\S]*?'manage'/
    );
    expect(migration).toMatch(
      /CREATE POLICY jumia_product_mappings_update_policy[\s\S]*?FOR UPDATE[\s\S]*?'integrations',[\s\S]*?'manage'/
    );
    expect(migration).toMatch(
      /CREATE POLICY jumia_product_mappings_delete_policy[\s\S]*?FOR DELETE[\s\S]*?'integrations',[\s\S]*?'manage'/
    );
  });

  it('requires referenced products and variants to belong to the mapping merchant', () => {
    for (const policy of ['insert_policy', 'update_policy']) {
      const block = migration.match(
        new RegExp(
          `CREATE POLICY jumia_product_mappings_${policy}[\\s\\S]*?\\);`
        )
      )?.[0];
      expect(block).toBeDefined();
      expect(block).toMatch(
        /FROM public\.products AS product[\s\S]*?product\.id = product_id[\s\S]*?product\.merchant_id = merchant_id/
      );
      expect(block).toMatch(
        /variant_id IS NULL[\s\S]*?FROM public\.product_variants AS variant[\s\S]*?variant\.id = variant_id[\s\S]*?variant\.merchant_id = merchant_id/
      );
    }
  });
});
