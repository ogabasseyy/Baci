import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20261110130000_merchant_cancel_order_refund_mode.sql'
  ),
  'utf8'
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
