import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    __dirname,
    '../../../../../supabase/migrations/20261110090000_order_cancellation_refund_alerts.sql'
  ),
  'utf8'
);

describe('order_cancellation_refund_alerts migration contract', () => {
  it('tracks attempts, last attempt, and confirmation for retries', () => {
    expect(sql).toMatch(/attempts integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/last_attempt_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/confirmed_at timestamptz,/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/);
  });

  it('lists reviews with an anti-join applied before the limit', () => {
    expect(sql).toContain(
      'LEFT JOIN public.order_cancellation_refund_alerts a ON a.review_id = r.id'
    );
    expect(sql).toMatch(/a\.review_id IS NULL/);
    expect(sql).toMatch(/a\.confirmed_at IS NULL/);
    expect(sql).toMatch(/a\.attempts < p_max_attempts/);
    expect(sql.indexOf('LEFT JOIN')).toBeLessThan(sql.indexOf('LIMIT LEAST'));
  });

  it('locks the RPC down to service_role', () => {
    expect(sql).toMatch(/SET search_path = ''/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.list_cancellation_refund_reviews_needing_alert_v1\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/\) TO service_role;/);
  });
});
