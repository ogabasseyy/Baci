import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const readMigrations = (migrationNames: readonly string[]) =>
  migrationNames
    .map((migrationName) =>
      readFileSync(resolve(migrationDirectory, migrationName), 'utf8')
    )
    .join('\n')
    .toLowerCase();
const recipientHardeningSql = readMigrations([
  '20260805151330_harden_admin_notification_recipient_delivery.sql',
]);
const recipientPrivilegeSql = readMigrations([
  '20260805151330_harden_admin_notification_recipient_delivery.sql',
  '20260805151360_harden_merchant_notification_table_privileges.sql',
]);
const markAllReadRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/mark-all-read/route.ts'),
  'utf8'
).toLowerCase();
const markAllVisibleNotificationsReadSql = readMigrations([
  '20260805151370_mark_all_visible_merchant_notifications_read.sql',
]);

describe('admin notification recipient migration contract', () => {
  it('uses the current paid-sales definitions for every selectable merchant segment', () => {
    expect(recipientHardeningSql).toContain(
      'function public.get_admin_notification_segment_merchant_ids'
    );
    expect(recipientHardeningSql).toContain(
      "p_segment not in ('new', 'active', 'at_risk')"
    );
    expect(recipientHardeningSql).toContain(
      "when 'new' then m.created_at >= statement_timestamp() - interval '30 days'"
    );
    expect(recipientHardeningSql).toContain(
      "when 'active' then ps.last_paid_at >= statement_timestamp() - interval '30 days'"
    );
    expect(recipientHardeningSql).toContain(
      "when 'at_risk' then ps.last_paid_at < statement_timestamp() - interval '30 days'"
    );
    expect(recipientHardeningSql).toContain(
      'max(coalesce(o.paid_at, o.updated_at, o.created_at)) as last_paid_at'
    );
    expect(recipientHardeningSql).toContain(
      "lower(btrim(o.payment_status)) = 'paid'"
    );
    expect(recipientHardeningSql).toContain(
      'new merchants were created in the last 30 days'
    );
    expect(recipientHardeningSql).not.toContain("date '2025-12-01'");
  });

  it('restricts recipient creation to an unexpired service-role processing lease', () => {
    expect(recipientHardeningSql).toContain(
      "auth.role()), '') <> 'service_role'"
    );
    expect(recipientHardeningSql).toContain("n.delivery_state = 'processing'");
    expect(recipientHardeningSql).toContain('n.sent_at is null');
    expect(recipientHardeningSql).toContain(
      'n.expires_at is null or n.expires_at > statement_timestamp()'
    );
    expect(recipientHardeningSql).toContain(
      'grant execute on function public.create_admin_notification_recipients_v1(uuid, uuid[])\n  to service_role'
    );
    expect(recipientHardeningSql).not.toContain(
      'to authenticated, service_role'
    );
  });

  it('keeps segment recipient identities worker-only', () => {
    const segmentFunctionStart = recipientHardeningSql.indexOf(
      'function public.get_admin_notification_segment_merchant_ids'
    );
    const segmentDefinition = recipientHardeningSql.slice(
      segmentFunctionStart,
      recipientHardeningSql.indexOf('comment on function', segmentFunctionStart)
    );
    expect(segmentDefinition).toContain("auth.role()), '') <> 'service_role'");
    expect(recipientHardeningSql).toContain(
      'revoke all on function public.get_admin_notification_segment_merchant_ids(text)\n  from public, anon, authenticated'
    );
    expect(recipientHardeningSql).toContain(
      'grant execute on function public.get_admin_notification_segment_merchant_ids(text)\n  to service_role'
    );
  });

  it('limits recipient row updates to merchant read and dismissal state', () => {
    expect(recipientPrivilegeSql).toContain(
      'revoke all on table public.merchant_notifications from anon'
    );
    expect(recipientPrivilegeSql).toContain(
      'revoke insert, delete, update on table public.merchant_notifications from authenticated'
    );
    expect(recipientPrivilegeSql).toContain(
      'grant select on table public.merchant_notifications to authenticated'
    );
    expect(recipientPrivilegeSql).toContain(
      'grant update (read_at, dismissed_at, banner_dismissed_at)\n  on table public.merchant_notifications to authenticated'
    );
    expect(recipientPrivilegeSql).toContain(
      'revoke all on table public.merchant_notifications from anon, authenticated'
    );
  });

  it('does not let notification-only platform roles query recipient identities', () => {
    expect(recipientHardeningSql).toContain(
      'drop policy if exists merchant_notifications_recipient_read\n  on public.merchant_notifications'
    );
    const policyStart = recipientHardeningSql.indexOf(
      'create policy merchant_notifications_recipient_read'
    );
    const recipientReadPolicy = recipientHardeningSql.slice(policyStart);
    expect(recipientReadPolicy).toContain(
      'public.has_merchant_access(merchant_id)'
    );
    expect(recipientReadPolicy).not.toContain(
      "public.current_user_has_platform_admin_permission_v1('notifications.manage')"
    );
  });

  it('marks every visible unread recipient atomically without a PostgREST row cap', () => {
    expect(markAllVisibleNotificationsReadSql).toContain(
      'function public.mark_all_visible_merchant_notifications_read_v1'
    );
    expect(markAllVisibleNotificationsReadSql).toContain('security definer');
    expect(markAllVisibleNotificationsReadSql).toContain(
      "set search_path = ''"
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      "auth.role()), '') <> 'authenticated'"
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      'public.has_merchant_access(p_merchant_id)'
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      'update public.merchant_notifications as mn\n  set read_at = statement_timestamp()\n  from public.notifications as n'
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      'get diagnostics v_updated_count = row_count'
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      'return query select v_updated_count, v_remaining_unread_count'
    );
    expect(markAllVisibleNotificationsReadSql).not.toMatch(/\blimit\b/);
    expect(markAllVisibleNotificationsReadSql).toContain(
      'revoke all on function public.mark_all_visible_merchant_notifications_read_v1(uuid)\n  from public, anon, service_role'
    );
    expect(markAllVisibleNotificationsReadSql).toContain(
      'grant execute on function public.mark_all_visible_merchant_notifications_read_v1(uuid)\n  to authenticated'
    );
    expect(markAllReadRouteSource).toContain(
      "rpc('mark_all_visible_merchant_notifications_read_v1'"
    );
    expect(markAllReadRouteSource).not.toContain(
      ".from('merchant_notifications')"
    );
  });
});
