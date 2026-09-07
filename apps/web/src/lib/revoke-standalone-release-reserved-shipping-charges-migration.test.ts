import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120000_revoke_standalone_release_reserved_shipping_charges.sql'
  ),
  'utf8'
);

describe('revoke standalone release reserved shipping charges migration', () => {
  it('revokes authenticated execute on the standalone reservation refund RPC', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.release_reserved_merchant_shipping_charges_for_order(uuid)'
    );
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).not.toContain('GRANT EXECUTE');
  });
});
