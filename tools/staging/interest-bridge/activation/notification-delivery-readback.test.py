from pathlib import Path
import re
import unittest


DIRECTORY = Path(__file__).parent
SQL = (DIRECTORY / 'notification-delivery-readback.sql').read_text()
ROOT = DIRECTORY.parents[3]
MIGRATIONS = ROOT / 'supabase' / 'migrations'


class NotificationDeliveryReadbackTests(unittest.TestCase):
    def test_readback_has_read_only_snapshot_time_bound_and_no_worker_calls(self):
        self.assertTrue(SQL.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'))
        self.assertTrue(SQL.endswith('ROLLBACK;\n'))
        self.assertIn("statement_timeout = '10s'", SQL)
        self.assertNotRegex(SQL, r'(?im)^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL|COPY|COMMIT|LOCK)\b')
        self.assertNotRegex(SQL, r'(?i)\b(?:public|savings_notifications)\.\w+\s*\(')
        self.assertNotIn('\\', SQL.replace('\\[', '').replace('\\]', ''))

    def test_physical_database_local_owner_and_exact_synthetic_scope_are_required(self):
        for guard in ("current_database() <> 'postgres'", "current_user <> 'postgres'",
                      "session_user <> 'postgres'", 'inet_client_addr() IS NOT NULL',
                      "<> '7685292944002592802'", "ERRCODE = '42501'"):
            self.assertIn(guard, SQL)
        for identity in ('10000000-0000-4000-8000-000000000001',
                         '10000000-0000-4000-8000-000000000002', '430314fd-cd8b-4579-98d4-e9f345713dd6'):
            self.assertEqual(SQL.count(identity), 2)
        for scope in ('event.merchant_id = target.merchant_id', 'event.customer_id = target.customer_id',
                      'event.goal_id = target.goal_id', 'token.merchant_id = target.merchant_id',
                      'customer.user_id = token.user_id', "token.app_type = 'storefront'"):
            self.assertIn(scope, SQL)

    def test_report_only_exports_aggregates_and_closed_redacted_categories(self):
        report = SQL.split('SELECT jsonb_build_object(', 1)[1]
        self.assertNotRegex(report, r'(?i)\b(?:title|body|push_token|ticket_id|claim_id|user_id|receipt_error)\b')
        self.assertNotRegex(SQL, r'(?i)\bto_jsonb\s*\(|SELECT\s+\w+\.\*|SELECT\s+\*')
        for marker in ("'deviceDeliveryVerified', false", "'providerCallsMade', false", "'servicesStarted', false",
                       'coalesce(sum(status_count), 0)', "coalesce(jsonb_object_agg(category, status_count), '{}'::jsonb)"):
            self.assertIn(marker, report)

    def test_delivery_columns_statuses_and_receipt_errors_match_real_migrations(self):
        storage = (MIGRATIONS / '20260925130000_customer_savings_engagement_storage.sql').read_text()
        receipts = (MIGRATIONS / '20260925130300_customer_savings_notification_receipts.sql').read_text()
        definition = storage.split('CREATE TABLE IF NOT EXISTS savings_notifications.deliveries (', 1)[1].split(');', 1)[0]
        for column in ('notification_id uuid', 'status text', 'claimed_at timestamptz', 'ticket_id text'):
            self.assertIn(column, definition)
        self.assertIn('ADD COLUMN IF NOT EXISTS receipt_error text', receipts)
        statuses = re.search(r"CHECK \(status IN \(([^)]+)\)\)", receipts)[1]
        for status in re.findall(r"'([^']+)'", statuses):
            self.assertIn("WHEN '" + status + "' THEN", SQL)
        source = (ROOT / 'apps/web/src/lib/savings-notifications/receipt-reconciliation.ts').read_text()
        for category in ('DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded', 'MismatchSenderId', 'InvalidCredentials'):
            self.assertIn("'" + category + "'", source)
            self.assertIn("'" + category + "'", receipts)
            self.assertIn("'" + category + "'", SQL)

    def test_current_token_absence_is_separate_from_persisted_receipt_failure(self):
        self.assertIn("'noCurrentlyEligibleToken', NOT EXISTS", SQL)
        self.assertIn("WHERE status = 'receipt_failed' GROUP BY receipt_category", SQL)
        self.assertIn("WHEN 'rejected' THEN 'rejected_reason_not_retained'", SQL)
        self.assertIn("WHEN 'accepted' THEN 'accepted_pending_receipt'", SQL)
        self.assertIn("WHEN 'provider_confirmed' THEN 'provider_confirmed'", SQL)
        delivery = (MIGRATIONS / '20260925130200_customer_savings_engagement_delivery.sql').read_text()
        pattern = "'^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$'"
        self.assertIn(pattern, delivery)
        self.assertIn(pattern, SQL)

    def test_api_count_mirrors_nonvoided_authenticated_customer_inbox_limit(self):
        storage = (MIGRATIONS / '20260925130000_customer_savings_engagement_storage.sql').read_text()
        self.assertIn('customer := savings_notifications.customer_for(p_merchant_id);', storage)
        self.assertIn('ORDER BY created_at DESC, id LIMIT 100', storage)
        inbox = SQL.split('), inbox AS (', 1)[1].split('SELECT jsonb_build_object(', 1)[0]
        self.assertIn('event.voided_at IS NULL', inbox)
        self.assertIn('ORDER BY event.created_at DESC, event.id LIMIT 100', inbox)
        self.assertNotIn('event.goal_id', inbox)

    def test_canonical_get_is_authenticated_read_only_and_reports_separate_delivery_capability(self):
        route = (ROOT / 'apps/web/src/app/api/storefront/customer/savings/notifications/route.ts').read_text()
        get = route.split('export async function GET(', 1)[1].split('export async function PATCH(', 1)[0]
        self.assertLess(get.index('await authenticate(request)'), get.index('safeParse('))
        self.assertIn("'get_customer_savings_notifications'", get)
        self.assertIn("process.env.SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED === 'true'", get)
        self.assertNotRegex(get, r'update_customer|mark_customer|runSavings|claim_push|record_receipt')


if __name__ == '__main__':
    unittest.main()
