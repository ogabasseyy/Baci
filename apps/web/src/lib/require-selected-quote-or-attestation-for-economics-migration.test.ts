import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904151000_require_selected_quote_or_attestation_for_economics.sql'
);

describe('require selected quote or attestation for economics migration', () => {
  it('drops the null selected_quote_id any-quote join and requires selected or attested binding', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_shipping_quote_booking_economics\(/i
    );
    expect(sql).toContain('o.selected_quote_id = sq.id');
    expect(sql).toContain('shipping_quote_attestations');
    expect(sql).not.toMatch(/o\.selected_quote_id IS NULL/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_shipping_quote_booking_economics\(uuid, uuid, uuid\)[\s\S]*FROM PUBLIC, anon;/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_shipping_quote_booking_economics\(uuid, uuid, uuid\)[\s\S]*TO authenticated, service_role;/i
    );
  });
});
