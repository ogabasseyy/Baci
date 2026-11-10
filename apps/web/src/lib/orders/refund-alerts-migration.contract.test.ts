import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    __dirname,
    '../../../../../supabase/migrations/20261111090200_order_cancellation_refund_alerts.sql'
  ),
  'utf8'
);

describe('order_cancellation_refund_alerts migration contract', () => {
  it('tracks attempts, last attempt, and confirmation for retries', () => {
    expect(sql).toMatch(/attempts integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/last_attempt_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/confirmed_at timestamptz,/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE/);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
  });

  it('cascades from orders and merchants, with indexed foreign keys', () => {
    expect(sql).toMatch(/REFERENCES public\.orders\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/REFERENCES public\.merchants\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(
      /alerts_order_idx\s+ON public\.order_cancellation_refund_alerts \(order_id\)/
    );
    expect(sql).toMatch(
      /alerts_merchant_idx\s+ON public\.order_cancellation_refund_alerts \(merchant_id\)/
    );
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

  it('excludes un-alertable reviews before the limit', () => {
    expect(sql).toContain(
      'JOIN public.orders o ON o.id = r.order_id AND o.merchant_id = r.merchant_id'
    );
    expect(sql.indexOf('JOIN public.orders')).toBeLessThan(
      sql.indexOf('LIMIT LEAST')
    );
  });

  it('orders never-attempted reviews first and oldest first', () => {
    expect(sql).toMatch(
      /ORDER BY\s+\(a\.review_id IS NOT NULL\),\s+CASE WHEN a\.review_id IS NULL THEN r\.created_at END ASC,\s+r\.created_at DESC/
    );
  });

  it('re-checks undeliverable alerts on a separate cool-down without attempts', () => {
    expect(sql).toMatch(/undeliverable_at timestamptz,/);
    expect(sql).toMatch(
      /attempts integer NOT NULL DEFAULT 1 CHECK \(attempts >= 0\)/
    );
    expect(sql).toMatch(/p_undeliverable_before timestamptz/);
    expect(sql).toMatch(
      /a\.undeliverable_at IS NULL\s+AND a\.attempts < p_max_attempts/
    );
    expect(sql).toMatch(/a\.undeliverable_at <= p_undeliverable_before/);
  });

  it('drops the policy before recreating it', () => {
    expect(
      sql.indexOf(
        'DROP POLICY IF EXISTS order_cancellation_refund_alerts_service_role'
      )
    ).toBeGreaterThan(-1);
    expect(
      sql.indexOf(
        'DROP POLICY IF EXISTS order_cancellation_refund_alerts_service_role'
      )
    ).toBeLessThan(
      sql.indexOf('CREATE POLICY order_cancellation_refund_alerts_service_role')
    );
  });

  it('locks the RPC down to service_role', () => {
    expect(sql).toMatch(/SECURITY INVOKER\s+SET search_path = ''/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.list_cancellation_refund_reviews_needing_alert_v1\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/\) TO service_role;/);
  });
});
