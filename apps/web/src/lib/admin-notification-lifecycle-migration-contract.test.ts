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
const notificationRlsSql = readFileSync(
  resolve(
    migrationDirectory,
    '20260805150900_harden_notification_rbac_and_realtime.sql'
  ),
  'utf8'
).toLowerCase();
const notificationRecipientRpcSql = readMigrations([
  '20260805150510_admin_notification_read_and_recipient_rpcs.sql',
]);
const notificationIndexSql = readFileSync(
  resolve(
    migrationDirectory,
    '20260805151100_admin_notifications_concurrent_indexes.sql'
  ),
  'utf8'
).toLowerCase();
const notificationRpcSql = readMigrations([
  '20260805150500_admin_notifications_repairs.sql',
  '20260805150510_admin_notification_read_and_recipient_rpcs.sql',
  '20260805150520_admin_notification_scheduled_delivery_rpcs.sql',
]);
const notificationLifecycleSql = readMigrations([
  '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
  '20260805151310_claim_scheduled_admin_notification_delivery.sql',
  '20260805151320_schedule_scheduled_admin_notification_worker.sql',
]);
const notificationsSql = readMigrations([
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
]);
const notificationTargetValidationSql = readFileSync(
  resolve(
    migrationDirectory,
    '20260805151210_validate_admin_notification_targets.sql'
  ),
  'utf8'
).toLowerCase();
const scheduledNotificationDeliverySource = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/functions/_shared/scheduled-notification-delivery.ts'
  ),
  'utf8'
);

describe('admin notification lifecycle migration contract', () => {
  it('uses the caller-safe RBAC wrapper and merchant-scoped Realtime rows', () => {
    expect(notificationRlsSql).toContain(
      "public.current_user_has_platform_admin_permission_v1('notifications.manage')"
    );
    expect(notificationRlsSql).not.toContain(
      'private.has_platform_admin_permission_v1'
    );
    expect(notificationRlsSql).toContain(
      'alter publication supabase_realtime add table public.merchant_notifications'
    );
    expect(notificationRlsSql).toContain(
      'alter table public.merchant_notifications replica identity full'
    );
    expect(notificationRlsSql).not.toContain(
      'create policy merchant_notifications_platform_insert'
    );
  });

  it('hides pre-finalization recipient rows while retaining admin lifecycle access', () => {
    expect(notificationRlsSql).toContain(
      'function public.is_sent_admin_notification_v1'
    );
    expect(notificationRlsSql).toContain('security definer');
    expect(notificationRlsSql).toContain("set search_path = ''");
    expect(notificationRlsSql).toContain('n.sent_at is not null');
    expect(notificationRlsSql).toContain("n.delivery_state = 'sent'");
    expect(notificationRlsSql).toContain(
      'public.is_sent_admin_notification_v1(notifications.id)'
    );
    expect(notificationRlsSql).toContain(
      'public.is_sent_admin_notification_v1(notification_id)'
    );
    expect(notificationRlsSql).toContain(
      "public.current_user_has_platform_admin_permission_v1('notifications.manage')"
    );
    expect(notificationRecipientRpcSql).toContain('n.sent_at is not null');
    expect(notificationRecipientRpcSql).toContain("n.delivery_state = 'sent'");
  });

  it('builds hot notification-table indexes concurrently outside a transaction', () => {
    expect(notificationRpcSql).not.toContain('create index');
    expect(notificationIndexSql).toContain('-- disable-transaction');
    expect(notificationIndexSql).toContain('create index concurrently');
    expect(notificationIndexSql).toContain(
      'idx_notifications_due_delivery_state'
    );
    expect(notificationIndexSql).toContain(
      'idx_merchant_notifications_notification_delivery'
    );
  });

  it('reclaims abandoned claims, caps retries, and exposes safe lifecycle state', () => {
    expect(notificationLifecycleSql).toContain("'failed'");
    expect(notificationLifecycleSql).toContain("interval '15 minutes'");
    expect(notificationLifecycleSql).toContain(
      'n.delivery_claimed_at is null\n      or n.delivery_claimed_at <'
    );
    expect(notificationLifecycleSql).toContain('delivery_attempts < 3');
    expect(notificationLifecycleSql).toContain('delivery_claim_token');
    expect(notificationLifecycleSql).toContain('regexp_replace');
    expect(notificationLifecycleSql).toContain('deliverypending');
    expect(notificationLifecycleSql).toContain('deliveryprocessing');
    expect(notificationLifecycleSql).toContain('deliveryfailed');
    expect(notificationLifecycleSql).toContain('deliveryexpired');
  });

  it('installs an idempotent, Vault-backed scheduled worker only when dependencies exist', () => {
    expect(notificationLifecycleSql).toContain("nspname = 'cron'");
    expect(notificationLifecycleSql).toContain("nspname = 'net'");
    expect(notificationLifecycleSql).toContain("'vault.decrypted_secrets'");
    expect(notificationLifecycleSql).toContain("name = 'project_url'");
    expect(notificationLifecycleSql).toContain("name = 'service_role_key'");
    expect(notificationLifecycleSql).toContain(
      "cron.unschedule('process-scheduled-admin-notifications')"
    );
    expect(notificationLifecycleSql).toContain('net.http_post');
    expect(notificationLifecycleSql).not.toContain('service_role_key :=');
  });

  it('creates columns before dependent RPCs and schedules after worker functions', () => {
    const columns = notificationsSql.indexOf(
      'add column if not exists delivery_claim_token'
    );
    const claims = notificationsSql.indexOf(
      'create function public.claim_scheduled_admin_notifications_v1'
    );
    const targetResolver = notificationsSql.indexOf(
      'function public.resolve_admin_notification_target_merchant_ids_v1'
    );
    const worker = notificationsSql.indexOf(
      'function private.invoke_scheduled_admin_notification_worker_v1'
    );
    const schedule = notificationsSql.indexOf('cron.schedule(');

    expect(columns).toBeGreaterThan(-1);
    expect(claims).toBeGreaterThan(columns);
    expect(targetResolver).toBeGreaterThan(-1);
    expect(worker).toBeGreaterThan(targetResolver);
    expect(schedule).toBeGreaterThan(worker);
  });

  it('resolves explicit targets through a permission-gated RPC', () => {
    expect(notificationTargetValidationSql).toContain(
      'function public.resolve_admin_notification_target_merchant_ids_v1'
    );
    expect(notificationTargetValidationSql).toContain('security definer');
    expect(notificationTargetValidationSql).toContain("set search_path = ''");
    expect(notificationTargetValidationSql).toContain('notifications.manage');
    expect(notificationTargetValidationSql).toContain(
      'from public.merchants as m'
    );
    expect(notificationTargetValidationSql).toContain(
      'grant execute on function public.resolve_admin_notification_target_merchant_ids_v1(uuid[]) to authenticated, service_role'
    );
    expect(notificationTargetValidationSql).not.toContain('to anon');
  });

  it('makes stale scheduled explicit targets terminal before delivery', () => {
    expect(notificationTargetValidationSql).toContain(
      'function public.resolve_admin_notification_target_merchant_ids_v1'
    );
    expect(scheduledNotificationDeliverySource).toContain(
      "'snapshot_claimed_notification_audience_v1'"
    );
    expect(scheduledNotificationDeliverySource).not.toContain(
      'return [...new Set(notification.target_merchant_ids)];'
    );
  });
});
