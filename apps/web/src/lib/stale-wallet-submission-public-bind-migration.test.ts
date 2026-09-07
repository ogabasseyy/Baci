import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903139000_hold_stale_wallet_submissions_and_public_bind.sql`,
  'utf8'
);

describe('stale wallet submission hold and public bind migration', () => {
  it('moves stale provider submissions to reconciliation instead of retry', () => {
    expect(sql).toContain("SET status = 'needs_reconciliation'");
    expect(sql).toContain("failure_code = 'STALE_PROVIDER_SUBMISSION'");
    expect(sql).not.toContain("SET status = 'reserved'");
  });

  it('keeps merchant-wallet funding while a bound quote remains selected', () => {
    expect(sql).toContain("OLD.shipping_funding_source = 'merchant_wallet'");
    expect(sql).toContain('NEW.selected_quote_id IS NOT NULL THEN');
    expect(sql).toContain("NEW.shipping_funding_source := 'merchant_wallet'");
  });

  it('returns only the public quote projection from bind_admin_gigl_quote', () => {
    const projection = sql.slice(sql.indexOf('jsonb_build_object('));
    expect(projection).toContain("'price'");
    expect(projection).not.toContain("'provider_cost'");
    expect(projection).not.toContain("'platform_margin'");
    expect(sql).not.toContain('to_jsonb(v_quote)');
  });
});
