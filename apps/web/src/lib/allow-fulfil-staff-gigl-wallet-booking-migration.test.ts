import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = resolve(process.cwd(), '../../supabase/migrations');
const read = (name: string) => readFileSync(resolve(migrations, name), 'utf8');
const sql = read('20261031130000_allow_fulfil_staff_gigl_wallet_booking.sql');

function definition(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const body = source.indexOf('AS $$', start);
  return source.slice(start, source.indexOf('$$;', body + 5) + 3);
}

const fulfilGate = (merchant: string) =>
  `public.check_staff_permission(\n    (SELECT auth.uid()), ${merchant}, 'orders', 'fulfill'\n  )`;
const fulfilEditGate = (merchant: string) =>
  `(
    public.check_staff_permission(
      (SELECT auth.uid()), ${merchant}, 'orders', 'fulfill'
    )
    AND public.check_staff_permission(
      (SELECT auth.uid()), ${merchant}, 'orders', 'edit'
    )
  )`;
const recoveryPreLock = [
  `OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.merchants m ON m.id=o.merchant_id
      WHERE o.id=p_order_id AND m.user_id=auth.uid()) THEN`,
  `OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=p_order_id
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','fulfill')
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','edit')) THEN`,
];
const recoveryPostLock = [
  `  IF NOT EXISTS (SELECT 1 FROM public.merchants
    WHERE id=v_order.merchant_id AND user_id=auth.uid()) THEN`,
  `  -- Hold the caller's staff row too, so revoking access waits for this write.
  PERFORM 1 FROM public.staff_members WHERE merchant_id=v_order.merchant_id
    AND user_id=auth.uid() FOR SHARE;
  IF NOT (public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','fulfill')
    AND public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','edit')) THEN`,
];

// [newest source, function, [[old gate, new gate], ...]]: everything outside
// the authorization lines must stay byte-identical to the newest definition.
const copied: [string, string, [string, string][]][] = [
  [
    '20260906120500_include_coordinates_in_stale_admin_gigl_bind_compare.sql',
    'public.bind_admin_gigl_quote',
    [
      [
        `NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  )`,
        `NOT ${fulfilEditGate('p_merchant_id')}`,
      ],
    ],
  ],
  [
    '20260905102000_owner_only_new_wallet_shipping_reservation.sql',
    'public.reserve_merchant_shipping_charge',
    [
      [
        `  -- New wallet debits move owner funds; staff recovery of existing rows is above.
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'wallet_reservation_owner_required'`,
        `  -- New wallet debits move merchant funds: the owner, or staff granted both
  -- orders.fulfill and orders.edit (the booking claim that consumes the debit
  -- needs orders.edit). Staff holding only one of the two may resume an
  -- existing charge above but cannot create a new debit.
  IF NOT (
    v_is_owner
    OR (
      public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
      )
      AND public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
      )
    )
  ) THEN
    RAISE EXCEPTION 'wallet_reservation_fulfill_edit_required'`,
      ],
    ],
  ],
  [
    '20260901193000_add_merchant_wallet_funding.sql',
    'public.fail_merchant_wallet_funding_request',
    [
      [
        `NOT EXISTS (SELECT 1 FROM public.merchants WHERE id=p_merchant_id AND user_id=(SELECT auth.uid())) THEN RAISE EXCEPTION 'merchant_owner_required'`,
        `NOT public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill') THEN RAISE EXCEPTION 'merchant_fulfill_required'`,
      ],
    ],
  ],
  [
    '20260903215100_share_wallet_funding_recovery_hmac.sql',
    'public.complete_merchant_wallet_funding_recovery',
    [
      [
        `NOT EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = p_merchant_id
      AND merchant.user_id = (SELECT auth.uid())
  )`,
        `NOT ${fulfilGate('p_merchant_id')}`,
      ],
    ],
  ],
  [
    '20261015215000_customer_checkout_shipping_recovery_activation_gate.sql',
    'private.assert_customer_checkout_shipping_recovery',
    [
      [recoveryPreLock[0], recoveryPreLock[1]],
      [recoveryPostLock[0], recoveryPostLock[1]],
    ],
  ],
  [
    '20261015145945_customer_checkout_shipping_recovery_committed_retry.sql',
    'public.confirm_customer_checkout_shipping_recovery',
    [
      [recoveryPreLock[0], recoveryPreLock[1]],
      [recoveryPostLock[0], recoveryPostLock[1]],
    ],
  ],
];

describe('fulfil staff GIG wallet booking migration', () => {
  it.each(
    copied
  )('copies %s %s verbatim except the authorization lines', (source, name, gates) => {
    let next = definition(sql, name);
    for (const [before, after] of gates) {
      expect(next.split(after)).toHaveLength(2);
      next = next.replace(after, before);
    }
    expect(next).toBe(definition(read(source), name));
  });

  it('removes every owner-only gate from the copied functions', () => {
    // A merchants lookup keyed on the caller is an owner check; the staff row
    // lock (staff_members ... user_id=auth.uid() FOR SHARE) is not.
    const ownerCheck =
      /public\.merchants[^;]*?user_id\s*=\s*(\(SELECT )?auth\.uid\(\)/g;
    for (const [, name] of copied) {
      const body = definition(sql, name);
      expect(body).toMatch(/'orders',\s*'fulfill'/);
      // Reservation keeps v_is_owner only as a short-circuit beside the helper.
      expect(body.match(ownerCheck) ?? []).toHaveLength(
        name === 'public.reserve_merchant_shipping_charge' ? 1 : 0
      );
    }
  });

  it('keeps the reservation entry gate and gates new debits on fulfill and edit', () => {
    const body = definition(sql, 'public.reserve_merchant_shipping_charge');
    const existing = body.indexOf('IF v_existing.id IS NOT NULL THEN');
    const gate = body.indexOf("'wallet_reservation_fulfill_edit_required'");
    const debit = body.indexOf('INSERT INTO public.wallet_transactions(');
    expect(existing).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(existing);
    expect(debit).toBeGreaterThan(gate);
    expect(body).toContain("v_order.merchant_id, 'orders', 'edit'");
    expect(body).not.toContain('wallet_reservation_owner_required');
  });

  it('adds a balance read that exposes one number to orders.fulfill callers', () => {
    const body = definition(sql, 'public.get_merchant_shipping_wallet_balance');
    expect(body).toContain('RETURNS numeric');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain(fulfilGate('p_merchant_id'));
    expect(body).toContain('SELECT wallet.available_balance');
    expect(body).not.toMatch(/total_earned|withdraw|settlement|payout/);
  });

  it('adds a funding-account read limited to the safe columns', () => {
    const body = definition(sql, 'public.get_merchant_wallet_funding_account');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain(fulfilGate('p_merchant_id'));
    expect(body).toContain("account.status IN ('active', 'pending')");
    expect(body).not.toMatch(/provider_account_id|provider_customer_code/);
    expect(body).not.toMatch(/metadata/);
  });

  it.each([
    'public.get_merchant_shipping_wallet_balance(uuid)',
    'public.get_merchant_wallet_funding_account(uuid)',
    'public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)',
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)',
    'public.fail_merchant_wallet_funding_request(uuid, uuid)',
    'public.confirm_customer_checkout_shipping_recovery(uuid, uuid, boolean)',
  ])('revokes PUBLIC, anon and authenticated before granting %s', (fn) => {
    const revoke = sql.indexOf(
      `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated;`
    );
    const grant = sql.indexOf(
      `GRANT EXECUTE ON FUNCTION ${fn}\n  TO authenticated;`
    );
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('restates the recovery-funding grants and keeps the assertion private', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_merchant_wallet_funding_recovery\([^)]*\)\n {2}FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public\.complete_merchant_wallet_funding_recovery\([^)]*\)\n {2}TO authenticated;/
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION private.assert_customer_checkout_shipping_recovery(uuid)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(sql).not.toMatch(
      /GRANT [^;]*private\.assert_customer_checkout_shipping_recovery/
    );
  });

  it('gates funding requests with the DEFINER helper, not inline staff joins', () => {
    const policies = sql.slice(
      sql.indexOf('DROP POLICY merchant_wallet_request_owner\n'),
      sql.indexOf('-- 6.')
    );
    expect(policies).toContain('FOR SELECT TO authenticated');
    expect(policies).toContain('FOR INSERT TO authenticated');
    expect(policies).toContain("status = 'pending'");
    expect(policies).toContain('AND requested_by = (SELECT auth.uid())');
    expect(
      policies.split("(SELECT auth.uid()), merchant_id, 'orders', 'fulfill'")
    ).toHaveLength(3);
    expect(policies).not.toMatch(/public\.merchants|staff_members/);
  });

  it.each([
    'public.bind_admin_gigl_quote',
    'public.reserve_merchant_shipping_charge',
    'private.assert_customer_checkout_shipping_recovery',
    'public.confirm_customer_checkout_shipping_recovery',
  ])('requires orders.edit beside orders.fulfill on the %s write gate', (name) => {
    // Booking (claim + final order write) runs under orders_update_policy
    // (owner or orders.edit): a fulfil-only bind, debit or destination change
    // could never be consumed by a booking.
    const body = definition(sql, name);
    const fulfil = body.match(/'orders',\s*'fulfill'/g) ?? [];
    const edit = body.match(/'orders',\s*'edit'/g) ?? [];
    // Every fulfill check is paired with an edit check (the reservation's
    // fulfill-OR-edit entry gate for resuming charges is one such pair).
    expect(fulfil.length).toBeGreaterThan(0);
    expect(edit).toHaveLength(fulfil.length);
  });

  it.each([
    'public.get_merchant_shipping_wallet_balance',
    'public.get_merchant_wallet_funding_account',
    'public.fail_merchant_wallet_funding_request',
    'public.complete_merchant_wallet_funding_recovery',
  ])('keeps the %s read/consent gate on orders.fulfill alone', (name) => {
    const body = definition(sql, name);
    expect(body).toMatch(/'orders',\s*'fulfill'/);
    expect(body).not.toMatch(/'orders',\s*'edit'/);
  });

  it('records the acting user on new debits and funding requests', () => {
    const firstFunction = sql.indexOf('CREATE OR REPLACE FUNCTION');
    const actor = sql.slice(0, firstFunction);
    // Added without a default first, so existing rows stay NULL.
    expect(actor).toContain(
      'ALTER TABLE public.merchant_shipping_charges ADD COLUMN reserved_by uuid;'
    );
    expect(actor).toContain(
      'ALTER TABLE public.merchant_shipping_charges\n  ALTER COLUMN reserved_by SET DEFAULT auth.uid();'
    );
    expect(actor).toContain(
      'ALTER TABLE public.merchant_wallet_funding_account_requests\n  ADD COLUMN requested_by uuid;'
    );
    expect(actor).toContain(
      'ALTER TABLE public.merchant_wallet_funding_account_requests\n  ALTER COLUMN requested_by SET DEFAULT auth.uid();'
    );
    expect(actor).toContain(
      'GRANT SELECT (reserved_by) ON TABLE public.merchant_shipping_charges TO authenticated;'
    );
    expect(actor).not.toMatch(/ADD COLUMN [a-z_]+ uuid[^;]*DEFAULT/);
    // The copied reserve INSERT does not list the column, so the default
    // captures the caller even inside the SECURITY DEFINER body.
    expect(
      definition(sql, 'public.reserve_merchant_shipping_charge')
    ).not.toContain('reserved_by');
  });

  it('keeps get_wallet_summary untouched', () => {
    expect(sql).not.toMatch(/FUNCTION public\.get_wallet_summary/);
  });
});
