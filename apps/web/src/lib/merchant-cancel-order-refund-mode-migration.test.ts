import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(
    resolve(process.cwd(), '../../supabase/migrations', name),
    'utf8'
  );
const sql = read('20261111090100_merchant_cancel_order_refund_mode.sql');
const helperSql = read(
  '20261111090000_merchant_cancel_order_refund_mode_helpers.sql'
);

describe('merchant cancellation refund-mode migration', () => {
  it('replaces the two-argument RPC with an optional third argument', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.cancel_order_as_merchant(uuid, text);'
    );
    expect(sql).toContain("p_refund_mode text DEFAULT 'automatic'");
    expect(sql).toContain("'invalid_refund_mode'");
  });

  it('seeds the refund step for automatic mode, and in manual mode only for refund-state legs', () => {
    expect(sql).toMatch(
      /IF EXISTS \([\s\S]*?v_refund_mode = 'automatic'\s+OR t\.status IN \('refund_pending', 'refunded'\)[\s\S]*?\) THEN\s+INSERT INTO public\.order_cancellation_side_effects[\s\S]*?'refund'/
    );
    // A completed leg alone never seeds the refund step in manual mode.
    expect(sql).not.toMatch(/IF v_refund_mode = 'manual' AND EXISTS/);
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

  it('also seeds the refund step in manual mode when the order has any refund row, terminal included', () => {
    const branch = sql.slice(
      sql.indexOf("v_refund_mode = 'manual' AND EXISTS ("),
      sql.indexOf(
        'INSERT INTO public.order_cancellation_side_effects',
        sql.indexOf("v_refund_mode = 'manual' AND EXISTS (")
      )
    );
    expect(branch).toContain("r.transaction_type = 'refund'");
    // No status allow-list: terminal refund rows seed it too.
    expect(branch).not.toContain("r.status NOT IN ('completed', 'refunded')");
    // Only a dead rejection (no provider identity) is exempt.
    // NULL-safe: a failed row with no verdict stamp must still seed the step,
    // so only an explicit 'failed' stamp (via COALESCE) is exempt.
    expect(branch).toContain(
      "COALESCE(r.metadata->>'provider_refund_status', '') = 'failed'"
    );
    expect(branch).not.toMatch(
      /AND r\.metadata->>'provider_refund_status' = 'failed'/
    );
  });

  it('exposes the movement-evidence gate to merchants only through a definer wrapper', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.order_has_unresolved_refund_evidence('
    );
    expect(sql).toContain(
      'private.unresolved_order_movement_evidence_v1(\n    p_order_id, v_merchant_id\n  )'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.order_has_unresolved_refund_evidence(uuid)\n  TO authenticated;'
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.order_has_unresolved_refund_evidence\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role, postgres;/
    );
  });

  it("answers a missing order with the same error as another merchant's order", () => {
    const wrapper = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.order_has_unresolved_refund_evidence('
      )
    );
    // Existence oracle guard: not-found must raise the membership gate's
    // refund_forbidden / 42501, never a distinguishable order_not_found.
    expect(wrapper).toContain(
      "IF v_merchant_id IS NULL THEN\n    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE = '42501';"
    );
    expect(wrapper).not.toContain('order_not_found');
    expect(wrapper).not.toContain('P0002');
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

  it('reloads the PostgREST schema cache after changing the RPC signature', () => {
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
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
