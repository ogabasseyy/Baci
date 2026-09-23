import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906100000_allow_order_editors_topship_booking_metadata.sql'
  ),
  'utf8'
);

describe('allow order editors topship booking metadata migration', () => {
  it('authorizes owners and staff with orders fulfill or edit', () => {
    expect(sql).toContain(
      "public.check_staff_permission(\n        (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'"
    );
    expect(sql).toContain(
      "public.check_staff_permission(\n        (SELECT auth.uid()), p_merchant_id, 'orders', 'edit'"
    );
    expect(sql).toContain('merchant.user_id = (SELECT auth.uid())');
  });
});
