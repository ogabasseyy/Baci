import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260814160000_repair_wallet_summary_projection_replay.sql'
  ),
  'utf8'
).toLowerCase();

describe('bugfix: wallet summary projection replay repair', () => {
  it('cascades the drop before recreating get_wallet_summary for replay', () => {
    expect(sql).toContain(
      'drop function if exists public.get_wallet_summary(uuid) cascade'
    );
    expect(sql).toContain('wallet.auto_payout_enabled');
  });
});
