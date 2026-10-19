import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260814150000_project_wallet_settings_in_summary_rpc.sql'
  ),
  'utf8'
).toLowerCase();

describe('wallet summary settings projection migration contract', () => {
  it('rebuilds get_wallet_summary with payout settings in the authorized projection', () => {
    expect(sql).toContain(
      'drop function if exists public.get_wallet_summary(uuid)'
    );
    expect(sql).toContain('auto_payout_enabled boolean');
    expect(sql).toContain('wallet.auto_payout_enabled');
    expect(sql).toContain("p_merchant_id, 'analytics', 'view'");
  });
});
