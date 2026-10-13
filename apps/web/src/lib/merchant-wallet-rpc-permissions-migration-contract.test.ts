import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805151550_harden_merchant_wallet_rpc_permissions.sql'
  ),
  'utf8'
);

describe('merchant wallet RPC permission migration contract', () => {
  it('does not let an active staff member initialize a wallet through the direct RPC', () => {
    const createWalletFunction = migration.split(
      'CREATE OR REPLACE FUNCTION public.get_wallet_summary'
    )[0];

    expect(createWalletFunction).toContain("SET search_path = ''");
    expect(createWalletFunction).toContain(
      'merchant.user_id = (SELECT auth.uid())'
    );
    expect(createWalletFunction).not.toContain('has_merchant_access');
    expect(createWalletFunction).toContain(
      "RAISE EXCEPTION 'merchant_owner_required'"
    );
  });

  it('requires analytics:view for direct wallet-summary RPC calls', () => {
    expect(migration).toContain("p_merchant_id, 'analytics', 'view'");
    expect(migration).toContain(
      "RAISE EXCEPTION 'merchant_wallet_read_required'"
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_wallet_summary(uuid)'
    );
    expect(migration).toContain('TO authenticated, service_role;');
  });
});
