import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(join(process.cwd(), '../../supabase/migrations', name), 'utf8');

describe('order payment account DVA hardening migrations', () => {
  it('keeps savings in refreshes and allows the service-role checkout path', () => {
    const savings = migration(
      '20260825200000_include_savings_in_dva_balance_refresh.sql'
    );
    const serviceRole = migration(
      '20260825204500_allow_service_role_dva_balance_refresh.sql'
    );
    expect(savings).toContain('customer_savings_redemptions');
    expect(savings).toContain(') + v_savings_paid');
    expect(serviceRole).toContain(
      "auth.uid() IS NULL AND auth.role() <> 'service_role'"
    );
    expect(serviceRole).toContain('TO authenticated, service_role;');
  });

  it('refreshes reused aliases without exposing the internal overload', () => {
    const hardened = migration(
      '20260825203000_harden_checkout_dva_reservation.sql'
    );
    expect(hardened).toContain("IF v_reservation_result = 'existing'");
    expect(hardened).toContain(
      'PERFORM public.refresh_paystack_order_payable_amount(p_order_id)'
    );
    expect(hardened).toContain(') FROM PUBLIC, anon, authenticated;');
    expect(hardened).toContain(') TO service_role;');
  });

  it('preserves expired history and normalizes email identity comparisons', () => {
    const history = migration(
      '20260825210000_preserve_paystack_alias_history.sql'
    );
    expect(history).not.toContain('DELETE FROM public.order_payment_accounts');
    expect(history).toContain('RETURN NOT EXISTS');
    expect(history).toContain(
      'lower(trim(NEW.customer_email)) IS DISTINCT FROM lower(trim(OLD.customer_email))'
    );
  });

  it('allows history rows while locking raw inserts in reservation order', () => {
    const historyRows = migration(
      '20260825213000_allow_paystack_alias_history_rows.sql'
    );
    expect(historyRows).toContain(
      'DROP CONSTRAINT IF EXISTS unique_order_account'
    );
    expect(historyRows.indexOf("'baci_order_payment:'")).toBeLessThan(
      historyRows.indexOf("'paystack_order_account:'")
    );
    expect(historyRows).toContain('account.order_id = NEW.order_id');
  });

  it('restores cross-order receiver exclusion for raw writers', () => {
    const crossOrder = migration(
      '20260825220000_restore_cross_order_paystack_alias_guard.sql'
    );
    expect(crossOrder).toContain('account.order_id <> NEW.order_id');
    expect(crossOrder).toContain(
      'account.account_number = trim(NEW.account_number)'
    );
  });

  it('freezes expired amount and customer-email snapshots', () => {
    const snapshots = migration(
      '20260825223000_freeze_paystack_alias_snapshots.sql'
    );
    expect(snapshots).toContain(
      'ADD COLUMN IF NOT EXISTS assignment_customer_email'
    );
    expect(snapshots).toContain(
      'ADD COLUMN IF NOT EXISTS assignment_customer_email_source'
    );
    expect(snapshots).toContain('NEW.payable_amount := OLD.payable_amount');
    expect(snapshots).toContain(
      'NEW.assignment_customer_email := OLD.assignment_customer_email'
    );
    expect(snapshots).toContain("'legacy_backfill'");
    expect(snapshots).toContain("'assignment'");
  });

  it('versions active balance snapshots and preserves invoice terms', () => {
    const versions = migration(
      '20260825230000_version_active_paystack_alias_snapshots.sql'
    );
    expect(versions).toContain("'paystack_version'");
    expect(versions).toContain('NEW.payable_amount := OLD.payable_amount');
    expect(versions).toContain("SET provider = 'paystack'");
    expect(versions).not.toContain("interval '90 minutes';\n  NEW.expires_at");
    expect(versions).toContain('bound_authenticated_paystack_alias_timestamps');
    expect(versions).toContain(
      "NEW.expires_at > NEW.assigned_at + interval '90 minutes'"
    );
    expect(versions).toContain('NEW.expires_at <= NEW.assigned_at');
    expect(versions).toContain('NEW.expires_at <= COALESCE(');
  });

  it('repairs invoice expiries truncated by the legacy clamp', () => {
    const repair = migration(
      '20260826001000_repair_invoice_paystack_alias_expiries.sql'
    );
    expect(repair).toContain("COALESCE(orders.payment_method, '')");
    expect(repair).toContain("interval '14 days'");
    expect(repair).toContain('account.expires_at = v_current.clamped_expiry');
    expect(repair).toContain("'paystack_order_account:'");
    expect(repair).toContain('FOR UPDATE OF account, orders');
    expect(repair).toContain('DISTINCT ON');
    expect(repair).toContain('remaining_balance');
    expect(repair).toContain('cancelled_at');
    expect(repair).toContain('payment_status');
    expect(repair).toContain('customer_wallet_payment_accounts');
    expect(repair).toContain('checkout_sessions');
    expect(repair.indexOf("'baci_order_payment:'")).toBeLessThan(
      repair.indexOf("'paystack_order_account:'")
    );
  });

  it('clears untrusted historical email backfills', () => {
    const untrusted = migration(
      '20260826002000_revoke_backfilled_paystack_alias_emails.sql'
    );
    expect(untrusted).toContain('SET assignment_customer_email = NULL');
    expect(untrusted).toContain(
      "assignment_customer_email_source = 'legacy_backfill'"
    );
    expect(untrusted).toContain(
      'expires_at = LEAST(COALESCE(account.expires_at, now()), now())'
    );
    expect(untrusted).toContain(
      "set_config(\n  'baci.paystack_alias_email_cleanup', 'on', true\n)"
    );
    expect(untrusted).toContain('current_setting(');
    expect(untrusted).not.toContain("auth.role(), '') = 'service_role'");
  });
});
