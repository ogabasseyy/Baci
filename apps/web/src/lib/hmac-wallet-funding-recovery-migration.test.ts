import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903212000_hmac_wallet_funding_recovery.sql'
  ),
  'utf8'
);

describe('hmac wallet funding recovery migration', () => {
  it('keeps direct persist on service_role and gates recovery with HMAC + session flag', () => {
    expect(sql).toContain("current_setting('baci.wallet_funding_recovery'");
    expect(sql).toContain(
      "set_config('baci.wallet_funding_recovery', '1', true)"
    );
    expect(sql).toContain('complete_merchant_wallet_funding_recovery');
    expect(sql).toContain("extensions.hmac(v_payload, v_secret, 'sha256')");
    expect(sql).toContain(
      'FROM private.merchant_wallet_funding_recovery_secrets'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.complete_merchant_wallet_funding_recovery'
    );
    expect(sql).toContain('TO authenticated;');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account'
    );
    expect(sql).toMatch(
      /persist_merchant_wallet_payment_account[\s\S]*TO service_role;/
    );
    expect(sql).not.toContain('TO service_role, authenticated');
  });
});
