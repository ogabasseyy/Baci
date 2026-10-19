import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const migration = (name) =>
  readFile(resolve('supabase/migrations', name), 'utf8');

test('merchant directory repair qualifies output-column sort expressions', async () => {
  const sql = await migration(
    '20260809154414_repair_admin_analytics_read_models.sql'
  );

  assert.match(sql, /THEN filtered\.total_gmv END DESC/);
  assert.match(sql, /THEN filtered\.total_orders END DESC/);
  assert.match(sql, /THEN filtered\.joined_at END DESC/);
  assert.match(sql, /filtered\.merchant_id ASC/);
});

test('Merchant 360 readiness does not require custom-domain verification', async () => {
  const sql = await migration(
    '20260809154415_repair_admin_merchant_360_readiness.sql'
  );

  assert.match(sql, /\{readiness,storefrontReady\}/);
  assert.match(sql, /hasStorefrontSlug/);
  assert.match(sql, /paymentConfigured/);
  assert.match(sql, /shippingConfigured/);
  assert.doesNotMatch(sql, /primary_domain\.verified_at/);
  assert.doesNotMatch(sql, /primary_domain\.ssl_status/);
});

test('Merchant 360 withholds GMV unless the display currency is known', async () => {
  const sql = await migration(
    '20260809173200_repair_admin_merchant_360_unknown_currency_gmv.sql'
  );

  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_merchant_360_v2\(uuid\)\n {2}RENAME TO get_admin_merchant_360_v2_currency_ambiguous/
  );
  assert.match(sql, /money_context\.display_currency IS NOT NULL/);
  assert.match(
    sql,
    /paid_orders\.order_currency = money_context\.display_currency/
  );
  assert.match(sql, /money_context\.display_currency IS NULL/);
  assert.match(
    sql,
    /paid_orders\.order_currency IS DISTINCT FROM money_context\.display_currency/
  );
  assert.match(sql, /<> 'UNK'/);
});

test('Merchant 360 preserves payout history across currency changes and counts all shipment exceptions', async () => {
  const sql = await migration(
    '20260811124500_repair_admin_merchant_360_payout_history_and_shipments.sql'
  );

  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_merchant_360_v2\(uuid\)\n {2}RENAME TO get_admin_merchant_360_v2_payout_history/
  );
  assert.match(sql, /FROM public\.payout_requests AS payout/);
  assert.match(sql, /NULL::numeric AS pending_amount/);
  assert.match(sql, /NULL::numeric AS failed_amount/);
  assert.match(sql, /NULL::numeric AS completed_amount/);
  assert.match(sql, /aggregate can span currencies/);
  assert.doesNotMatch(sql, /payout\.currency\).*payout_currency/);
  assert.match(
    sql,
    /'shipment_exception', 'delivery_attempt_failed', 'returned'/
  );
  assert.match(sql, /\{incidents,shipmentFailures30d\}/);
});

test('reconciliation repair retains currency-less settlement activity without money labels', async () => {
  const sql = await migration(
    '20260809154416_repair_admin_reconciliation_currencyless_activity.sql'
  );

  assert.match(sql, /NULL::numeric AS amount/);
  assert.match(sql, /NULL::text AS currency/);
  assert.match(sql, /FROM settlement_rows sr\n {4}WHERE sr\.status IN/);
  assert.doesNotMatch(sql, /sr\.currency = p_currency/);
  assert.match(sql, /'pendingAmount', NULL, 'pendingCount', sm\.pending_count/);
  assert.match(
    sql,
    /'directSettlements', jsonb_build_object\('amount', NULL, 'count', dm\.count\)/
  );
});

test('system health only considers recent failed email attempts', async () => {
  const sql = await migration(
    '20260809154417_repair_admin_system_health_email_freshness.sql'
  );

  assert.match(sql, /email_attempt\.created_at >= v_now - interval '24 hours'/);
  assert.match(
    sql,
    /email_attempt\.status = 'pending'\n {8}AND email_attempt\.updated_at < v_now - interval '15 minutes'/
  );
  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_system_health_v1\(\) RENAME TO get_admin_system_health_v0/
  );
  assert.match(sql, /'emailFailureWindow', '24 hours'/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_admin_system_health_v0\(\)/
  );
});

test('system health bounds terminal push failures and indexes audience-member cascades', async () => {
  const sql = await migration(
    '20260809170137_repair_admin_push_health_and_audience_snapshot_index.sql'
  );

  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_system_health_v1\(\)\n {2}RENAME TO get_admin_system_health_v1_email_freshness/
  );
  assert.match(
    sql,
    /push_attempt\.status IN \('failed', 'partial_failure'\)\n {6}AND push_attempt\.created_at >= v_now - interval '24 hours'/
  );
  assert.match(sql, /'pushFailureWindow', '24 hours'/);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS admin_notification_audience_snapshot_merchant_id_idx\n {2}ON public\.admin_notification_audience_snapshot \(merchant_id\)/
  );
});

test('operations withholds currencyless settlement money, indexes membership actors, and includes returned shipments in health', async () => {
  const sql = await migration(
    '20260809173000_repair_admin_operations_currency_and_health_indexes.sql'
  );
  const indexSql = await migration(
    '20260809173100_index_platform_admin_membership_actors.sql'
  );

  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_operations_v2\(text, integer, integer\)\n {2}RENAME TO get_admin_operations_v2_error_code_projection/
  );
  assert.match(
    sql,
    /jsonb_set\(item\.value, '\{netAmount\}', 'null'::jsonb, true\)/
  );
  assert.match(
    sql,
    /jsonb_set\(\n {12}jsonb_set\(item\.value, '\{netAmount\}', 'null'::jsonb, true\),\n {12}'\{currency\}', 'null'::jsonb, true/
  );
  assert.match(indexSql, /^-- disable-transaction/);
  assert.match(indexSql, /AND NOT index_state\.indisvalid/g);
  assert.match(
    indexSql,
    /DROP INDEX IF EXISTS public\.platform_admin_memberships_granted_by_idx/
  );
  assert.match(
    indexSql,
    /DROP INDEX IF EXISTS public\.platform_admin_memberships_revoked_by_idx/
  );
  assert.match(
    indexSql,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_admin_memberships_granted_by_idx\n {2}ON public\.platform_admin_memberships \(granted_by\)/
  );
  assert.match(
    indexSql,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_admin_memberships_revoked_by_idx\n {2}ON public\.platform_admin_memberships \(revoked_by\)/
  );
  assert.match(
    sql,
    /ALTER FUNCTION public\.get_admin_system_health_v1\(\)\n {2}RENAME TO get_admin_system_health_v1_push_freshness/
  );
  assert.match(sql, /'delivery_attempt_failed',\n {6}'returned'/);
  assert.match(sql, /shipment\.updated_at >= v_now - interval '24 hours'/);
});

test('operations repair includes stale pending emails in its incident projection', async () => {
  const sql = await migration(
    '20260809154917_repair_admin_operations_stale_email_attempts.sql'
  );

  assert.match(sql, /attempt\.status = 'pending'/);
  assert.match(sql, /attempt\.updated_at < v_now - interval '15 minutes'/);
  assert.match(sql, /\{summary,notifications\}/);
  assert.match(sql, /\{notifications,email\}/);
  assert.match(
    sql,
    /attempt\.status = 'failed'\n {6}OR \(attempt\.status = 'pending'/
  );
  assert.match(
    sql,
    /'status', CASE WHEN email_attempt\.status = 'failed' THEN 'failed' ELSE 'stale' END/
  );
  assert.doesNotMatch(sql, /\|\| v_stale_pending_items/);
  assert.match(sql, /FUNCTION public\.get_admin_operations_v0/);
});

test('isolated replay exercises the production operations v2 projection', async () => {
  const sql = await readFile(
    resolve('supabase/tests/admin_analytics_read_model_repairs.sql'),
    'utf8'
  );

  assert.match(
    sql,
    /\\ir \.\.\/migrations\/20260805151570_harden_admin_error_code_projections\.sql/
  );
  assert.match(
    sql,
    /public\.get_admin_operations_v2\('notifications', 25, 0\)/
  );
  assert.match(
    sql,
    /\{notifications,email,0,status\}'\) IS DISTINCT FROM 'stale'/
  );
  assert.match(
    sql,
    /fresh pending email incorrectly appears in operations incidents/
  );
  assert.match(
    sql,
    /\\ir \.\.\/migrations\/20260809173000_repair_admin_operations_currency_and_health_indexes\.sql/
  );
  assert.match(
    sql,
    /\\ir \.\.\/migrations\/20260809173100_index_platform_admin_membership_actors\.sql/
  );
  assert.match(
    sql,
    /\\ir \.\.\/migrations\/20260809173200_repair_admin_merchant_360_unknown_currency_gmv\.sql/
  );
  assert.match(
    sql,
    /\\ir \.\.\/migrations\/20260811124500_repair_admin_merchant_360_payout_history_and_shipments\.sql/
  );
  assert.match(sql, /public\.get_admin_operations_v2\('financial', 25, 0\)/);
  assert.match(
    sql,
    /operations settlement projection still exposes currencyless money or lost incident metadata/
  );
  assert.match(sql, /recent returned shipment is absent from system health/);
  assert.match(
    sql,
    /Merchant 360 counted unknown-currency paid orders as GMV instead of excluding them/
  );
});
