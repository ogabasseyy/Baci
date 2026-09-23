import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120400_revoke_authenticated_shipping_quote_booking_economics.sql'
  ),
  'utf8'
);

describe('revoke authenticated shipping quote booking economics', () => {
  it('bugfix: keeps booking economics behind service_role only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_shipping_quote_booking_economics(uuid, uuid, uuid)'
    );
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_shipping_quote_booking_economics(uuid, uuid, uuid)'
    );
    expect(sql).toMatch(/TO service_role;/);
    expect(sql).not.toMatch(/TO authenticated,\s*service_role/);
  });
});
