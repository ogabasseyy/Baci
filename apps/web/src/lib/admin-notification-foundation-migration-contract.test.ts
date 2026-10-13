import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const notificationMigrationNames = [
  '20260805150500_admin_notifications_repairs.sql',
  '20260805150510_admin_notification_read_and_recipient_rpcs.sql',
  '20260805150520_admin_notification_scheduled_delivery_rpcs.sql',
  '20260805150900_harden_notification_rbac_and_realtime.sql',
  '20260805151100_admin_notifications_concurrent_indexes.sql',
  '20260805151210_validate_admin_notification_targets.sql',
  '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
  '20260805151310_claim_scheduled_admin_notification_delivery.sql',
  '20260805151320_schedule_scheduled_admin_notification_worker.sql',
  '20260805151330_harden_admin_notification_recipient_delivery.sql',
  '20260805151360_harden_merchant_notification_table_privileges.sql',
  '20260805151370_mark_all_visible_merchant_notifications_read.sql',
  '20260809184000_repair_admin_notification_dashboard_literal_search.sql',
  '20260811150001_prune_terminal_notification_audience_snapshots.sql',
  '20260812110001_harden_notification_delivery_and_operations_access.sql',
  '20260817220000_repair_admin_aov_and_notification_quiet_delivery.sql',
  '20260812123000_preserve_started_notifications_during_quiet_deferral.sql',
  '20260817221000_allow_repeated_quiet_hour_deferrals.sql',
  '20260817222000_repair_notification_deferral_and_finalize.sql',
  '20260814130000_separate_quiet_deferral_failure_attempts.sql',
  '20260814140000_repair_notification_manager_rls_and_access_roster.sql',
] as const;
const readMigrations = (migrationNames: readonly string[]) =>
  migrationNames
    .map((migrationName) =>
      readFileSync(resolve(migrationDirectory, migrationName), 'utf8')
    )
    .join('\n')
    .toLowerCase();
const notificationsSql = readMigrations(notificationMigrationNames);
const notificationStateBackfillSql = readMigrations([
  '20260805150500_admin_notifications_repairs.sql',
]);
const notificationLifecycleDashboardSql = readMigrations([
  '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
]);
const notificationDetailSql = readMigrations([
  '20260805150510_admin_notification_read_and_recipient_rpcs.sql',
  '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
]);

describe('admin notification foundation migration contract', () => {
  it('keeps each notification migration under 300 lines in deployment order', () => {
    expect(notificationMigrationNames).toEqual([
      '20260805150500_admin_notifications_repairs.sql',
      '20260805150510_admin_notification_read_and_recipient_rpcs.sql',
      '20260805150520_admin_notification_scheduled_delivery_rpcs.sql',
      '20260805150900_harden_notification_rbac_and_realtime.sql',
      '20260805151100_admin_notifications_concurrent_indexes.sql',
      '20260805151210_validate_admin_notification_targets.sql',
      '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
      '20260805151310_claim_scheduled_admin_notification_delivery.sql',
      '20260805151320_schedule_scheduled_admin_notification_worker.sql',
      '20260805151330_harden_admin_notification_recipient_delivery.sql',
      '20260805151360_harden_merchant_notification_table_privileges.sql',
      '20260805151370_mark_all_visible_merchant_notifications_read.sql',
      '20260809184000_repair_admin_notification_dashboard_literal_search.sql',
      '20260811150001_prune_terminal_notification_audience_snapshots.sql',
      '20260812110001_harden_notification_delivery_and_operations_access.sql',
      '20260817220000_repair_admin_aov_and_notification_quiet_delivery.sql',
      '20260812123000_preserve_started_notifications_during_quiet_deferral.sql',
      '20260817221000_allow_repeated_quiet_hour_deferrals.sql',
      '20260817222000_repair_notification_deferral_and_finalize.sql',
      '20260814130000_separate_quiet_deferral_failure_attempts.sql',
      '20260814140000_repair_notification_manager_rls_and_access_roster.sql',
    ]);

    for (const migrationName of notificationMigrationNames) {
      const sql = readFileSync(
        resolve(migrationDirectory, migrationName),
        'utf8'
      );
      expect(sql.split('\n').length - 1).toBeLessThanOrEqual(300);
    }
  });

  it('keeps recipient visibility dashboard-permission-scoped and ages unknown push outcomes', () => {
    const sql = readMigrations([
      '20260812110001_harden_notification_delivery_and_operations_access.sql',
    ]);

    expect(sql).toContain("'dashboard', 'view'");
    expect(sql).toContain(
      "status='unknown' and updated_at>statement_timestamp()-interval '24 hours'"
    );
    expect(sql).toContain(
      'revoke all on function public.get_admin_operations_v1(text, integer, integer)'
    );
  });

  it('keeps dashboard totals search literal with an explicit LIKE escape', () => {
    const sql = readMigrations([
      '20260809184000_repair_admin_notification_dashboard_literal_search.sql',
    ]);
    const escapedSearch = String.raw`replace(replace(replace(p_search, e'\\', e'\\\\'), '%', e'\\%'), '_', e'\\_')`;
    const escapeClause = String.raw`escape e'\\'`;

    expect(sql).toContain(escapedSearch);
    expect(sql.split(escapeClause)).toHaveLength(3);
    expect(sql).toContain(
      'grant execute on function public.get_admin_notification_dashboard(text, text, text, text)\n  to authenticated'
    );
  });

  it('prunes only the claim snapshot after terminal finalization', () => {
    const sql = readMigrations([
      '20260811150001_prune_terminal_notification_audience_snapshots.sql',
    ]);

    expect(sql).toContain(
      'if v_row_count > 0 and v_terminal then\n    delete from public.admin_notification_audience_snapshot'
    );
    expect(sql).toContain(
      'where notification_id = p_notification_id and claim_token = p_claim_token'
    );
    expect(sql).toContain(
      'select n.delivery_attempts >= 3\n    into v_terminal'
    );
    expect(sql).toContain(
      'grant execute on function public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)\n  to service_role'
    );
  });

  it('prunes a stale terminal lease snapshot and reschedules quiet-hour delivery without resetting delivery start', () => {
    const sql = readMigrations([
      '20260817220000_repair_admin_aov_and_notification_quiet_delivery.sql',
    ]);

    expect(sql).toContain('n.delivery_attempts >= 3');
    expect(sql).toContain('s.claim_token = n.delivery_claim_token');
    expect(sql).toContain(
      "p_outcome not in ('sent', 'retry', 'expired', 'deferred')"
    );
    const quietDeferralSql = readMigrations([
      '20260812123000_preserve_started_notifications_during_quiet_deferral.sql',
    ]);
    expect(sql).toContain(
      "scheduled_for = statement_timestamp() + interval '15 minutes'"
    );
    expect(sql).toContain("v_terminal or p_outcome = 'deferred'");
    expect(quietDeferralSql).not.toContain('delivery_attempts = greatest');
    expect(quietDeferralSql).toContain(
      "p_outcome not in ('sent', 'retry', 'expired', 'deferred')"
    );
    const repeatedDeferralSql = readMigrations([
      '20260817221000_allow_repeated_quiet_hour_deferrals.sql',
    ]);
    expect(repeatedDeferralSql).toContain(
      "n.delivery_attempts < 3 or n.delivery_last_error = 'quiet_hours_deferred'"
    );
    expect(repeatedDeferralSql).toContain(
      "delivery_attempts = case when n.delivery_last_error = 'quiet_hours_deferred' then n.delivery_attempts"
    );
    expect(repeatedDeferralSql).toContain(
      "delivery_last_error = 'quiet_hours_deferred'"
    );
    expect(repeatedDeferralSql).not.toContain('delivery_attempts = greatest');
  });

  it('uses narrow authenticated admin RPCs rather than a broad table bypass', () => {
    expect(notificationsSql).toContain(
      'function public.get_admin_notification_detail'
    );
    expect(notificationsSql).toContain(
      'function public.get_admin_notification_dashboard'
    );
    expect(notificationsSql).toContain(
      'function public.get_admin_notification_stats_batch'
    );
    expect(notificationsSql).toContain("set search_path = ''");
    expect(notificationsSql).toContain(
      "private.has_platform_admin_permission_v1(\n        (select auth.uid()),\n        'notifications.manage'"
    );
    expect(notificationsSql).not.toContain(
      'admin_merchant.is_platform_admin is true'
    );
    expect(notificationsSql).toContain(
      'grant execute on function public.get_admin_notification_detail(uuid) to authenticated'
    );
    expect(notificationsSql).not.toContain(
      'grant execute on function public.get_admin_notification_detail(uuid) to anon'
    );
  });

  it('counts active banners only while they are actually unexpired', () => {
    expect(notificationsSql).toContain('channels @> \'["banner"]\'::jsonb');
    expect(notificationsSql).toContain(
      'expires_at is null or expires_at > statement_timestamp()'
    );
  });

  it('backfills legacy delivery state before lifecycle RPCs inspect it', () => {
    expect(notificationStateBackfillSql).toContain(
      "when sent_at is not null then 'sent'"
    );
    expect(notificationStateBackfillSql).toContain(
      "when expires_at is not null and expires_at <= statement_timestamp() then 'expired'"
    );
    expect(notificationStateBackfillSql).toContain(
      'where sent_at is not null\n  or (sent_at is null and expires_at is not null'
    );
    expect(
      notificationStateBackfillSql.indexOf('update public.notifications')
    ).toBeGreaterThan(
      notificationStateBackfillSql.indexOf(
        'add constraint notifications_delivery_state_check'
      )
    );
    expect(
      notificationStateBackfillSql.indexOf('update public.notifications')
    ).toBeLessThan(
      notificationStateBackfillSql.indexOf(
        'function public.get_admin_notification_segment_merchant_ids'
      )
    );
  });

  it('filters the final dashboard by lifecycle status rather than legacy drafts', () => {
    expect(notificationLifecycleDashboardSql).toContain(
      "'all', 'sent', 'scheduled', 'queued', 'processing', 'failed', 'expired'"
    );
    expect(notificationLifecycleDashboardSql).not.toContain("'draft'");
    expect(notificationLifecycleDashboardSql).toContain(
      "p_status = 'scheduled' and n.sent_at is null\n        and n.delivery_state = 'pending'\n        and n.scheduled_for > statement_timestamp()"
    );
    expect(notificationLifecycleDashboardSql).toContain(
      "p_status = 'queued' and n.sent_at is null\n        and n.delivery_state = 'pending'\n        and n.scheduled_for <= statement_timestamp()"
    );
    for (const status of ['processing', 'failed', 'expired']) {
      expect(notificationLifecycleDashboardSql).toContain(
        `p_status = '${status}' and n.delivery_state = '${status}'`
      );
    }
  });

  it('redacts recipient detail unless the notification admin can read merchants', () => {
    expect(notificationDetailSql).toContain(
      'v_can_read_merchants boolean := false'
    );
    expect(notificationDetailSql).toContain("'merchants.read'");
    expect(notificationDetailSql).toContain(
      "'deliveries', case when v_can_read_merchants then coalesce(("
    );
    expect(notificationDetailSql).toContain("else '[]'::jsonb end");
    expect(notificationDetailSql).toContain(
      "'target_merchant_ids', case when v_can_read_merchants"
    );
    expect(notificationDetailSql).toContain(
      "then n.target_merchant_ids else '{}'::uuid[] end"
    );
    expect(notificationDetailSql).toContain("'total_sent', count(mn.id)");
    expect(notificationDetailSql).toContain(
      "'total_read', count(mn.id) filter (where mn.read_at is not null)"
    );
    expect(notificationDetailSql).toContain(
      "'total_dismissed', count(mn.id) filter (where mn.dismissed_at is not null)"
    );
  });

  it('uses durable recipient records and atomic worker state transitions', () => {
    expect(notificationsSql).toContain(
      'function public.create_admin_notification_recipients_v1'
    );
    expect(notificationsSql).toContain(
      'on conflict (notification_id, merchant_id) do nothing'
    );
    expect(notificationsSql).toContain(
      'function public.claim_scheduled_admin_notifications_v1'
    );
    expect(notificationsSql).toContain('for update skip locked');
    expect(notificationsSql).toContain(
      'function public.finalize_scheduled_admin_notification_v1'
    );
    expect(notificationsSql).toContain("'expired'");
    expect(notificationsSql).toContain("'processing'");
  });

  it('gates user-invokable notification RPCs through notifications.manage', () => {
    for (const functionName of [
      'get_admin_notification_detail',
      'get_admin_notification_dashboard',
      'get_admin_notification_stats_batch',
    ]) {
      const functionStart = notificationsSql.indexOf(
        `function public.${functionName}`
      );
      const nextFunction = notificationsSql.indexOf(
        'create or replace function public.',
        functionStart + 1
      );
      const definition = notificationsSql.slice(
        functionStart,
        nextFunction === -1 ? undefined : nextFunction
      );
      expect(definition).toContain('notifications.manage');
    }

    expect(notificationsSql).toContain(
      'function public.claim_scheduled_admin_notifications_v1'
    );
    expect(notificationsSql).toContain("'service_role' then");
  });
});
