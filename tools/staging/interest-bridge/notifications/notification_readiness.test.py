from pathlib import Path
import unittest


DIRECTORY = Path(__file__).parent
SQL = (DIRECTORY / 'notification-readiness.sql').read_text()
README = (DIRECTORY / 'README.md').read_text()
MIGRATION_DIRECTORY = DIRECTORY.parents[3] / 'supabase' / 'migrations'


class NotificationReadinessTests(unittest.TestCase):
    def test_inventory_is_read_only_and_rollback_bounded(self):
        self.assertIn('BEGIN READ ONLY;', SQL)
        self.assertIn('ROLLBACK;', SQL)
        self.assertNotRegex(SQL, r'(?im)^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b')
        self.assertNotRegex(SQL, r'(?i)\b(SELECT|PERFORM|CALL)\s+savings_notifications\.(claim_push|pending_receipts|enqueue_due|record_receipt)\s*\(')

    def test_inventory_binds_physical_database_and_synthetic_identity(self):
        self.assertIn("'7685292944002592802'", SQL)
        for identity in (
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002',
            '430314fd-cd8b-4579-98d4-e9f345713dd6',
        ):
            self.assertIn(identity, SQL)
        self.assertIn("'baci_savings_notifications_worker'", SQL)

    def test_readiness_report_avoids_credentials_and_provider_activity(self):
        self.assertIn("'providerCallsMade', false", SQL)
        self.assertIn("'servicesStarted', false", SQL)
        self.assertIn('do not include push tokens', README.lower())
        self.assertIn('2026-10-06T15:59:10Z', README)

    def test_scoped_counts_sum_group_rows_and_missing_role_is_explicit(self):
        self.assertIn("'count', coalesce(sum(type_count), 0)", SQL)
        self.assertIn("'count', coalesce(sum(status_count), 0)", SQL)
        self.assertIn("'exists', role.oid IS NOT NULL", SQL)
        self.assertIn("LEFT JOIN pg_roles role ON role.rolname = 'baci_savings_notifications_worker'", SQL)
        self.assertIn("ELSE false END", SQL)

    def test_schema_names_and_function_signatures_match_append_only_migrations(self):
        storage = (MIGRATION_DIRECTORY / '20260925130000_customer_savings_engagement_storage.sql').read_text()
        goals = (MIGRATION_DIRECTORY / '20260521130000_customer_wallet_dva_and_device_savings_tables.sql').read_text()
        events = (MIGRATION_DIRECTORY / '20260925130100_customer_savings_engagement_events.sql').read_text()
        delivery = (MIGRATION_DIRECTORY / '20260925130200_customer_savings_engagement_delivery.sql').read_text()
        receipts = (MIGRATION_DIRECTORY / '20260925130300_customer_savings_notification_receipts.sql').read_text()
        for declaration in (
            'CREATE TABLE IF NOT EXISTS savings_notifications.events (',
            'CREATE TABLE IF NOT EXISTS savings_notifications.deliveries (',
        ):
            self.assertIn(declaration, storage)
        event_definition = storage.split('CREATE TABLE IF NOT EXISTS savings_notifications.events (', 1)[1].split(');', 1)[0]
        for column in ('merchant_id uuid', 'customer_id uuid', 'goal_id uuid', 'type text'):
            self.assertIn(column, event_definition)
        self.assertIn('notification_id uuid NOT NULL', storage)
        self.assertIn('status text NOT NULL', storage)
        self.assertIn('CREATE TABLE IF NOT EXISTS public.customer_savings_goals', goals)
        for column in ('status text', 'target_amount numeric(12,2)', 'current_amount numeric(12,2)'):
            self.assertIn(column, goals)
        for signature, source in (
            ('savings_notifications.enqueue_due() RETURNS integer', events),
            ('savings_notifications.claim_push(p_limit integer DEFAULT 50)', delivery),
            ('savings_notifications.finish_push(p_notification_id uuid, p_push_token text, p_claim_id uuid,', delivery),
            ('savings_notifications.pending_receipts(p_limit integer DEFAULT 100)', receipts),
            ('savings_notifications.record_receipt(p_ticket_id text, p_status text, p_error text DEFAULT NULL)', receipts),
        ):
            self.assertIn(signature, source)
        for signature in (
            'savings_notifications.enqueue_due()',
            'savings_notifications.claim_push(integer)',
            'savings_notifications.finish_push(uuid,text,uuid,text,text)',
            'savings_notifications.pending_receipts(integer)',
            'savings_notifications.record_receipt(text,text,text)',
        ):
            self.assertIn(signature, SQL)


if __name__ == '__main__':
    unittest.main()
