import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215100_share_wallet_funding_recovery_hmac.sql'
  ),
  'utf8'
);

describe('share wallet funding recovery hmac migration', () => {
  it('clears isolated random secrets and requires shared service-role provisioning', () => {
    expect(sql).toContain('set_merchant_wallet_funding_recovery_hmac_secret');
    expect(sql).toContain("SET secret = ''");
    expect(sql).toContain('recovery_secret_unprovisioned');
    expect(sql).toContain(
      "coalesce((SELECT auth.role()), '') <> 'service_role'"
    );
    expect(sql).toContain('TO service_role;');
    expect(sql).not.toContain('gen_random_bytes');
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/app/api/cron/provision-wallet-funding-recovery-hmac/route.ts'
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/lib/provision-merchant-wallet-funding-recovery-hmac.ts'
        )
      )
    ).toBe(true);
  });
});
