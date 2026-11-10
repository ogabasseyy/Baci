import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(
    resolve(process.cwd(), '../../supabase/migrations', name),
    'utf8'
  );
const sql = read('20261110130000_merchant_cancel_order_refund_mode.sql');
const helperSql = read(
  '20261110125900_merchant_cancel_order_refund_mode_helpers.sql'
);

describe('merchant cancellation refund-mode migration', () => {
  it('replaces the two-argument RPC with an optional third argument', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.cancel_order_as_merchant(uuid, text);'
    );
    expect(sql).toContain("p_refund_mode text DEFAULT 'automatic'");
    expect(sql).toContain("'invalid_refund_mode'");
  });

  it('seeds the refund step only for the automatic mode', () => {
    expect(sql).toContain("IF v_refund_mode = 'automatic' AND EXISTS (");
    // The customer email step stays unconditional.
    expect(sql).toMatch(/'customer_email', 'failed'/);
  });

  it('records the refund mode as a tracked audit field', () => {
    expect(sql).toContain("'cancellation_refund_mode'\n    ],");
    expect(sql).toContain(
      "'cancellation_refund_mode', v_order.cancellation_refund_mode"
    );
    expect(sql).toContain("'cancellation_refund_mode', v_refund_mode\n    ),");
    expect(sql).toContain('o.cancelled_by, o.cancellation_refund_mode');
  });

  it('requires the owner or orders.refund for the cancel-only mode', () => {
    expect(sql).toMatch(
      /IF v_refund_mode = 'manual' AND NOT \([\s\S]*?'orders', 'refund'[\s\S]*?order_cancel_refund_forbidden' USING ERRCODE = '42501'/
    );
  });

  it('keeps both migrations within the module size limit and delegates to the helpers', () => {
    expect(sql.split('\n').length).toBeLessThanOrEqual(300);
    expect(helperSql.split('\n').length).toBeLessThanOrEqual(300);
    expect(sql).toContain('private.merchant_cancel_payment_in_flight(');
    expect(sql).toContain(
      'private.transition_verified_abandoned_captures_for_cancel('
    );
    expect(helperSql).toContain(
      'ADD COLUMN IF NOT EXISTS cancellation_refund_mode text'
    );
    expect(helperSql).toContain(
      'REVOKE ALL ON FUNCTION private.merchant_cancel_payment_in_flight(uuid, uuid)'
    );
  });

  it('grants the column to authenticated only, never anon', () => {
    expect(helperSql).toContain(
      'GRANT SELECT (cancellation_refund_mode) ON TABLE public.orders TO authenticated;'
    );
    expect(helperSql).not.toMatch(
      /GRANT SELECT \(cancellation_refund_mode\)[^;]*anon/
    );
  });

  it('rejects direct client writes to the mode outside the cancel RPC', () => {
    expect(helperSql).toContain("IF current_user IN ('authenticated', 'anon')");
    expect(helperSql).toMatch(
      /BEFORE INSERT OR UPDATE OF cancellation_refund_mode ON public\.orders[\s\S]*?EXECUTE FUNCTION private\.guard_order_cancellation_refund_mode\(\)/
    );
    expect(helperSql).toContain(
      'REVOKE ALL ON FUNCTION private.guard_order_cancellation_refund_mode()'
    );
    // The RPC is SECURITY DEFINER, so its own writes run as the owner.
    expect(sql).toContain('SECURITY DEFINER');
  });

  it('stores the mode on the order and keeps the grants exact', () => {
    expect(sql).toContain('cancellation_refund_mode = v_refund_mode');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.cancel_order_as_merchant(uuid, text, text)\n  FROM PUBLIC, anon, authenticated, service_role, postgres;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.cancel_order_as_merchant(uuid, text, text)\n  TO authenticated;'
    );
  });
});
