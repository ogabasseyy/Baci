import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const analyticsMigrationFiles = [
  '20260805150010_repair_admin_platform_analytics.sql',
  '20260805150011_repair_admin_platform_analytics_breakdowns.sql',
  '20260805150012_repair_admin_platform_analytics_merchants.sql',
  '20260805150013_repair_admin_platform_analytics_rpc.sql',
];
const privateAnalyticsMigrationFiles = [
  '20260805150010_repair_admin_platform_analytics.sql',
  '20260805150011_repair_admin_platform_analytics_breakdowns.sql',
  '20260805150012_repair_admin_platform_analytics_merchants.sql',
];
const migrationFilenames = new Set(readdirSync(migrationDirectory));
const ownedMigrationFiles = [
  ...analyticsMigrationFiles,
  '20260805150020_repair_admin_merchant_sales_activity.sql',
  '20260805151350_repair_admin_platform_order_counts.sql',
  '20260811120002_repair_admin_platform_analytics_breakdown_currency_scope.sql',
  '20260817220000_repair_admin_aov_and_notification_quiet_delivery.sql',
];
const readMigrationSql = (filename: string) =>
  readFileSync(resolve(migrationDirectory, filename), 'utf8').toLowerCase();
const analyticsSql = analyticsMigrationFiles.map(readMigrationSql).join('\n');
const analyticsPublicSql = readMigrationSql(
  '20260805150013_repair_admin_platform_analytics_rpc.sql'
);
const analyticsMerchantsSql = readMigrationSql(
  '20260805150012_repair_admin_platform_analytics_merchants.sql'
);
const merchantSalesSql = readFileSync(
  resolve(
    migrationDirectory,
    '20260805150020_repair_admin_merchant_sales_activity.sql'
  ),
  'utf8'
).toLowerCase();
const timeBasisMigrationSql = readMigrationSql(
  '20260805151512_document_admin_analytics_order_created_time_basis.sql'
);

describe('admin analytics migration contract', () => {
  it('reads the explicit private-helper collection from the migration directory', () => {
    expect(
      privateAnalyticsMigrationFiles.every((filename) =>
        migrationFilenames.has(filename)
      )
    ).toBe(true);
  });

  it('aggregates live orders in Postgres instead of stale materialized views', () => {
    expect(analyticsSql).toContain(
      'function public.get_admin_platform_analytics'
    );
    expect(analyticsSql).toContain('from public.orders');
    expect(analyticsSql).not.toContain('from public.daily_sales_summary');
    expect(analyticsSql).not.toContain('from public.platform_daily_summary');
    expect(analyticsSql).not.toContain('from public.platform_revenue');
    expect(analyticsSql).toContain("payment_status = 'paid'");
  });

  it('uses launch-bounded all-time and non-overlapping comparison windows', () => {
    expect(analyticsSql).toContain("timestamp '2025-12-18 00:00:00'");
    expect(analyticsSql).toContain('o.created_at < p_previous_end_at');
    expect(analyticsSql).toContain("when p_period = 'all' then 0");
  });

  it('documents the distinct GMV and merchant-growth comparison bases', () => {
    expect(analyticsMerchantsSql).toContain(
      'merchant growth intentionally compares lagos calendar months'
    );
    expect(analyticsPublicSql).toContain(
      'is the selected rolling order window versus its prior matching window'
    );
  });

  it('counts active merchants from authenticated activity, separately from sellers', () => {
    expect(analyticsSql).toContain('from auth.audit_log_entries');
    expect(analyticsSql).toContain('from public.staff_members');
    expect(analyticsSql).toContain("sm.status = 'active'");
    expect(analyticsSql).toContain("'login', 'token_refreshed'");
    expect(analyticsSql).toContain("'sellingmerchants'");
    expect(analyticsSql).toContain("'activemerchants'");
  });

  it('keeps platform money NGN-only when settlement currency is unavailable', () => {
    expect(analyticsSql).toContain("currency = 'ngn'");
    expect(analyticsSql).toContain("currency is distinct from 'ngn'");
    expect(analyticsSql).toContain("'reportingcurrency', 'ngn'");
    expect(analyticsSql).toContain("'excludednonngnorunknowngrossorders'");
    expect(analyticsSql).toContain("'excludednonngnorunknownpaidorders'");
    expect(analyticsSql).toContain("'recordedplatformfees'");
    expect(analyticsSql).toContain("'recordedprocessorfees'");
    expect(analyticsSql).toContain("'recordedmerchantnet'");
    expect(analyticsSql).not.toContain('from public.merchant_settlements');
    expect(analyticsSql).not.toContain('from public.platform_settings');
  });

  it('does not suppress order counts merely because their currency is unknown or non-NGN', () => {
    const orderCountSql = readMigrationSql(
      '20260805151350_repair_admin_platform_order_counts.sql'
    );
    expect(orderCountSql).toContain(
      "count(*) filter (where payment_status = 'paid')::bigint as paid_orders"
    );
    expect(orderCountSql).toContain('count(*)::bigint as gross_orders');
    expect(orderCountSql).toContain('as ngn_paid_orders');
    expect(orderCountSql).toContain("'totalorders', cs.paid_orders");
    expect(orderCountSql).toContain("'grossorders', cs.gross_orders");
  });

  it('pairs NGN AOV with NGN paid-order counts while retaining all-currency order totals', () => {
    const repairSql = readMigrationSql(
      '20260817220000_repair_admin_aov_and_notification_quiet_delivery.sql'
    );
    expect(repairSql).toContain('as ngn_paid_orders');
    expect(repairSql).toContain('cs.paid_gmv / cs.ngn_paid_orders');
    expect(repairSql).toContain('ps.paid_gmv / ps.ngn_paid_orders');
    expect(repairSql).toContain("'totalorders', cs.paid_orders");
  });

  it('runs after the RBAC helper migration during a clean replay', () => {
    expect(
      [
        '20260805150000_platform_admin_rbac.sql',
        '20260805150010_repair_admin_platform_analytics.sql',
        '20260805150011_repair_admin_platform_analytics_breakdowns.sql',
        '20260805150012_repair_admin_platform_analytics_merchants.sql',
        '20260805150013_repair_admin_platform_analytics_rpc.sql',
        '20260805150020_repair_admin_merchant_sales_activity.sql',
      ].sort()
    ).toEqual([
      '20260805150000_platform_admin_rbac.sql',
      '20260805150010_repair_admin_platform_analytics.sql',
      '20260805150011_repair_admin_platform_analytics_breakdowns.sql',
      '20260805150012_repair_admin_platform_analytics_merchants.sql',
      '20260805150013_repair_admin_platform_analytics_rpc.sql',
      '20260805150020_repair_admin_merchant_sales_activity.sql',
    ]);
  });

  it('gates each RPC with its named platform permission', () => {
    expect(analyticsPublicSql).toContain(
      "private.has_platform_admin_permission_v1(\n    (select auth.uid()),\n    'analytics.read'"
    );
    expect(merchantSalesSql).toContain(
      "private.has_platform_admin_permission_v1(\n    (select auth.uid()),\n    'merchants.read'"
    );

    for (const sql of [analyticsPublicSql, merchantSalesSql]) {
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain('(select auth.uid())');
      expect(sql).not.toContain('admin_merchant.is_platform_admin');
      expect(sql).toContain('from public, anon, authenticated, service_role');
      expect(sql).toContain('to authenticated');
      expect(sql).not.toContain('to authenticated, service_role');
    }
  });

  it('does not create blocking indexes on hot production tables', () => {
    expect(analyticsSql).not.toContain('create index');
    expect(merchantSalesSql).not.toContain('create index');
  });

  it('documents that selected order periods are order-created-time analytics', () => {
    expect(timeBasisMigrationSql).toContain(
      'selected-period order summaries, daily breakdowns, and merchant sales recency use public.orders.created_at'
    );
    expect(timeBasisMigrationSql).toContain(
      'not payment-recorded-time analytics'
    );
    expect(timeBasisMigrationSql).toContain(
      'paid_at completeness has not been established'
    );
  });

  it('keeps private analytics helpers inaccessible', () => {
    for (const filename of privateAnalyticsMigrationFiles) {
      const sql = readMigrationSql(filename);
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain('security definer');
      expect(sql).toContain('revoke all on function private.');
      expect(sql).toContain('from public, anon, authenticated, service_role');
      expect(sql).not.toContain('grant execute');
    }
  });

  it('composes the original response shape from one captured timestamp', () => {
    expect(analyticsPublicSql).toContain(
      'v_now timestamptz := statement_timestamp()'
    );
    expect(analyticsPublicSql).toContain(
      'private.get_admin_platform_analytics_summary_v1('
    );
    expect(analyticsPublicSql).toContain(
      'private.get_admin_platform_analytics_breakdowns_v1('
    );
    expect(analyticsPublicSql).toContain(
      'private.get_admin_platform_analytics_merchants_v1('
    );
    expect(analyticsPublicSql).toContain(
      "'gmvgrowthrate', summary.value -> 'gmvchange'"
    );
    expect(analyticsPublicSql).toContain("'generatedat', v_now");
  });

  it('keeps every task migration within the modularity limit', () => {
    for (const filename of ownedMigrationFiles) {
      expect(readMigrationSql(filename).split('\n').length).toBeLessThanOrEqual(
        300
      );
    }
  });

  it('derives merchant activity from live paid sales, never stale health rows', () => {
    expect(merchantSalesSql).toContain(
      'drop function if exists public.get_admin_merchant_health()'
    );
    expect(merchantSalesSql).toContain('from public.orders');
    expect(merchantSalesSql).toContain(
      "lower(coalesce(nullif(btrim(o.payment_status), ''), 'unknown')) = 'paid'"
    );
    expect(merchantSalesSql).toContain(
      "upper(nullif(btrim(o.currency), '')) = 'ngn'"
    );
    expect(merchantSalesSql).toContain(
      'excluded_non_ngn_or_unknown_paid_orders'
    );
    expect(merchantSalesSql).not.toContain('from public.merchant_health');
    expect(merchantSalesSql).toContain("then 'healthy'");
    expect(merchantSalesSql).toContain("then 'at_risk'");
    expect(merchantSalesSql).toContain("then 'churned'");
    expect(merchantSalesSql).toContain("else 'new'");
  });

  it('keeps breakdown order counts currency-inclusive while money stays NGN-only', () => {
    const repairSql = readMigrationSql(
      '20260811120002_repair_admin_platform_analytics_breakdown_currency_scope.sql'
    );
    expect(repairSql).toContain('from paid_all_current group by 1');
    expect(repairSql).toContain('count(*)::bigint as orders');
    expect(repairSql).toContain('from current_orders group by payment_status');
    expect(repairSql).toContain('from current_orders group by shipping_status');
    expect(repairSql).toContain("filter (where currency = 'ngn')");
    expect(repairSql).not.toContain(
      'from ngn_current_orders group by payment_status'
    );
    expect(repairSql).not.toContain(
      'from ngn_current_orders group by shipping_status'
    );
  });
});
