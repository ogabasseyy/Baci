import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825003000_scope_order_payment_account_mutations.sql'
  ),
  'utf8'
);
const authoritativeMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825004500_authoritative_paystack_order_account_reservation.sql'
  ),
  'utf8'
);
const crossFlowMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825010000_serialize_paystack_dva_cross_flow_aliases.sql'
  ),
  'utf8'
);
const aliasLifecycleMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825013000_complete_paystack_dva_order_alias_lifecycle.sql'
  ),
  'utf8'
);
const emailLifecycleMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825014500_expire_paystack_dva_alias_on_email_change.sql'
  ),
  'utf8'
);
const reprovisionMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825020000_reprovision_expired_paystack_order_aliases.sql'
  ),
  'utf8'
);
const viewRefreshMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825141127_allow_order_view_dva_balance_refresh.sql'
  ),
  'utf8'
);
const reservationEmailMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825142000_revalidate_paystack_order_email_at_reservation.sql'
  ),
  'utf8'
);
const authorizedReservationEmailMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825143500_authorize_paystack_order_email_revalidation.sql'
  ),
  'utf8'
);
const adminEditBalanceMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825150000_refresh_dva_balance_after_admin_order_edit.sql'
  ),
  'utf8'
);
const adminEditLockMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825151500_lock_admin_order_edit_before_dva_refresh.sql'
  ),
  'utf8'
);
const checkoutReservationMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825182000_authorize_checkout_dva_reservation.sql'
  ),
  'utf8'
);
const aliasUpdateMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827010000_guard_paystack_alias_updates.sql'
  ),
  'utf8'
);
const aliasUpdateRepairMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827020000_exclude_updated_paystack_alias_rows.sql'
  ),
  'utf8'
);
describe('order payment account mutation RPC migration', () => {
  it('removes broad updates and scopes payable refreshes to accessible orders', () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS owners_and_staff_update_order_payment_accounts'
    );
    expect(migration).toContain('refresh_paystack_order_payable_amount');
    expect(migration).toContain(
      'public.has_merchant_access(orders.merchant_id)'
    );
    expect(migration).toContain("account.provider = 'paystack'");
  });

  it('serializes account reservations before checking aliases across merchants', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("'paystack_order_account:'");
    expect(migration).toContain("RETURN 'conflict'");
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account'
    );
  });

  it('derives the payable amount under the order lock without caller input', () => {
    expect(authoritativeMigration).toContain("'baci_order_payment:'");
    expect(authoritativeMigration).toContain('FOR UPDATE');
    expect(authoritativeMigration).not.toContain('p_payable_amount');
    expect(authoritativeMigration).toContain(
      "auth.uid(), v_merchant_id, 'orders', 'edit'"
    );
  });

  it('revalidates terminal order state and rejects active wallet accounts', () => {
    expect(authoritativeMigration).toContain("RETURN 'ineligible'");
    expect(authoritativeMigration).toContain(
      'public.customer_wallet_payment_accounts'
    );
    expect(authoritativeMigration).toContain("RETURN 'wallet_conflict'");
  });

  it('serializes order, wallet, and agentic aliases on one account lock', () => {
    expect(crossFlowMigration.match(/paystack_order_account:/g)).toHaveLength(
      3
    );
    expect(crossFlowMigration).toContain(
      'public.customer_wallet_payment_accounts'
    );
    expect(crossFlowMigration).toContain('public.checkout_sessions');
    expect(crossFlowMigration).toContain('public.order_payment_accounts');
    expect(crossFlowMigration).toContain('BEFORE INSERT OR UPDATE OF');
  });

  it('guards other eligible orders and releases terminal aliases', () => {
    expect(aliasLifecycleMigration).toContain(
      'JOIN public.orders AS orders ON orders.id = account.order_id'
    );
    expect(aliasLifecycleMigration).toContain(
      "orders.payment_status IN ('pending', 'unpaid', 'partially_paid')"
    );
    expect(aliasLifecycleMigration).toContain(
      'expire_terminal_order_paystack_dva_aliases'
    );
    expect(aliasLifecycleMigration).toContain(
      'AFTER UPDATE OF payment_status, shipping_status, cancelled_at'
    );
  });

  it('expires the alias when its Paystack customer email changes', () => {
    expect(emailLifecycleMigration).toContain(
      'NEW.customer_email IS DISTINCT FROM OLD.customer_email'
    );
    expect(emailLifecycleMigration).toContain(
      'AFTER UPDATE OF payment_status, shipping_status, cancelled_at, customer_email'
    );
  });

  it('clamps long expiries and releases expired rows for reprovisioning', () => {
    expect(reprovisionMigration).toContain("interval '90 minutes'");
    expect(reprovisionMigration).toContain(
      'release_expired_paystack_order_account'
    );
    expect(reprovisionMigration).toContain(
      'DELETE FROM public.order_payment_accounts'
    );
  });

  it('allows order viewers to refresh derived DVA balances without widening reservation access', () => {
    expect(viewRefreshMigration).toContain(
      "auth.uid(), v_merchant_id, 'orders', 'view'"
    );
    expect(viewRefreshMigration).toContain(
      "auth.uid(), v_merchant_id, 'orders', 'edit'"
    );
    expect(viewRefreshMigration).not.toContain(
      'reserve_paystack_order_payment_account'
    );
  });

  it('locks and revalidates the Paystack customer email before reservation', () => {
    expect(reservationEmailMigration).toContain('FOR UPDATE');
    expect(reservationEmailMigration).toContain('p_expected_customer_email');
    expect(reservationEmailMigration).toContain("RETURN 'customer_changed'");
    expect(reservationEmailMigration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account'
    );
  });

  it('authorizes access before revealing whether the customer email matches', () => {
    const permissionOffset = authorizedReservationEmailMigration.indexOf(
      'public.check_staff_permission'
    );
    const comparisonOffset = authorizedReservationEmailMigration.indexOf(
      'v_customer_email IS DISTINCT FROM'
    );

    expect(permissionOffset).toBeGreaterThan(-1);
    expect(comparisonOffset).toBeGreaterThan(permissionOffset);
    expect(authorizedReservationEmailMigration).toContain("'orders', 'edit'");
  });

  it('refreshes the authoritative DVA balance after successful admin edits', () => {
    expect(adminEditBalanceMigration).toContain(
      'RENAME TO update_admin_order_without_dva_balance_refresh'
    );
    expect(adminEditBalanceMigration).toContain(
      'public.refresh_paystack_order_payable_amount(p_order_id)'
    );
    expect(adminEditBalanceMigration.indexOf('v_result :=')).toBeLessThan(
      adminEditBalanceMigration.indexOf(
        'public.refresh_paystack_order_payable_amount(p_order_id)'
      )
    );
  });

  it('takes the payment advisory lock before the admin editor locks the order', () => {
    const lockOffset = adminEditLockMigration.indexOf(
      'pg_catalog.pg_advisory_xact_lock'
    );
    const editOffset = adminEditLockMigration.indexOf(
      'public.update_admin_order_without_dva_balance_refresh'
    );

    expect(lockOffset).toBeGreaterThan(-1);
    expect(editOffset).toBeGreaterThan(lockOffset);
    expect(adminEditLockMigration).toContain("'baci_order_payment:'");
  });

  it('lets only the trusted checkout service use the atomic reservation path', () => {
    expect(checkoutReservationMigration).toContain(
      "auth.role() <> 'service_role'"
    );
    expect(checkoutReservationMigration).toContain(
      'TO authenticated, service_role'
    );
    expect(checkoutReservationMigration).toContain('FOR UPDATE');
    expect(checkoutReservationMigration).toContain("RETURN 'ineligible'");
    expect(checkoutReservationMigration).toContain(
      'FROM public.customer_savings_redemptions AS redemptions'
    );
    expect(checkoutReservationMigration).toContain(
      "redemptions.metadata ->> 'reversed_at' IS NULL"
    );
    expect(checkoutReservationMigration).toContain(
      'SET expires_at = GREATEST('
    );
    expect(checkoutReservationMigration).toContain(') + v_savings_paid');
    expect(
      checkoutReservationMigration.indexOf("RETURN 'existing'")
    ).toBeLessThan(
      checkoutReservationMigration.indexOf(
        'INSERT INTO public.order_payment_accounts'
      )
    );
  });

  it('guards cross-flow alias ownership updates as well as inserts', () => {
    expect(aliasUpdateMigration).toContain(
      'BEFORE INSERT OR UPDATE OF provider, account_number, order_id, assigned_at'
    );
    expect(aliasUpdateMigration).toContain(
      'public.guard_order_paystack_dva_alias()'
    );
    expect(aliasUpdateMigration).toContain(
      'public.reject_cross_order_paystack_dva_alias()'
    );
    expect(aliasUpdateMigration).toContain(
      'z_reject_cross_order_paystack_dva_alias'
    );
  });

  it('excludes the current row from alias conflicts during lifecycle updates', () => {
    expect(aliasUpdateRepairMigration).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(aliasUpdateRepairMigration).toContain('v_current_id := OLD.id;');
    expect(
      aliasUpdateRepairMigration.match(
        /account\.id IS DISTINCT FROM v_current_id/g
      )
    ).toHaveLength(2);
  });
});
