import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    'legacy_enrollment_fixture',
    ROOT / 'tools/staging/prefunded-card/legacy-enrollment-local.test.py',
)
LEGACY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LEGACY)


class EnrollmentCutover(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_type = LEGACY.LegacyEnrollment
        cls.fixture_type.setUpClass()
        cls.fixture = cls.fixture_type(
            'test_reconciliation_provenance_exact_replay_and_fail_closed_cases'
        )
        cls.fixture.run_candidate(cls.fixture.proof())

    @classmethod
    def tearDownClass(cls):
        cls.fixture_type.tearDownClass()

    def test_migrated_receipt_replay_accepts_legacy_uuid_linked_to_pvb_id(self):
        fixture = self.fixture
        fixture.sql(
            f"INSERT INTO prefunded_card.credit_routes VALUES('{LEGACY.GOAL}',"
            f"'{LEGACY.INTEGRATION}','{LEGACY.MERCHANT}','{LEGACY.CUSTOMER}',"
            f"'{fixture.database.system}',now())"
        )

        def recognize(
            transaction_id=LEGACY.LEGACY_TRANSACTION,
            event_data_id=LEGACY.LEGACY_DATA,
            event_id=LEGACY.EVENT,
            customer_id='scratch-event-customer',
            wallet_id='scratch-private-wallet',
            amount_kobo=10000,
            reference=LEGACY.LEGACY_REFERENCE,
            session_id=LEGACY.LEGACY_SESSION,
            credited_at=LEGACY.LEGACY_CREDITED_AT,
        ):
            return fixture.sql(
                "SET SESSION AUTHORIZATION prefunded_treasury_operator; "
                "SELECT public.recognize_piggyvest_staging_inflow("
                f"'{transaction_id}','{event_data_id}','{event_id}',"
                f"'{customer_id}','{wallet_id}',{amount_kobo},0,"
                f"'{reference}','{session_id}','{credited_at}'); "
                "RESET SESSION AUTHORIZATION"
            )

        outcomes = {
            'legacy UUID alias': recognize(),
            'canonical PVB ID': recognize(transaction_id=LEGACY.PVB_TRANSACTION),
            'wrong amount': recognize(amount_kobo=10001),
            'wrong customer': recognize(customer_id='other-customer'),
            'wrong wallet': recognize(wallet_id='other-wallet'),
            'unknown alias': recognize(transaction_id='unknown-legacy-alias'),
            'unrelated reference member': recognize(
                transaction_id=LEGACY.LEGACY_REFERENCE
            ),
            'changed event': recognize(event_id='changed-event'),
            'unmatched fresh receipt': recognize(
                transaction_id='fresh-legacy-uuid',
                event_data_id='fresh-event-data',
                event_id='fresh-event',
                reference='fresh-reference',
                session_id='fresh-session',
            ),
        }

        self.assertEqual(
            outcomes,
            {
                'legacy UUID alias': 'duplicate',
                'canonical PVB ID': 'duplicate',
                'wrong amount': 'reconciliation_required',
                'wrong customer': 'reconciliation_required',
                'wrong wallet': 'reconciliation_required',
                'unknown alias': 'reconciliation_required',
                'unrelated reference member': 'reconciliation_required',
                'changed event': 'deferred',
                'unmatched fresh receipt': 'deferred',
            },
        )
        self.assertEqual(
            fixture.sql(
                "SELECT (SELECT count(*) FROM public.customer_savings_contributions)"
                "||':'||(SELECT current_amount FROM public.customer_savings_goals)"
                "||':'||(SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings"
                " WHERE account='principal')"
                "||':'||(SELECT count(*) FROM prefunded_card.bank_projections)"
            ),
            '1:100.00:10000:1',
        )


if __name__ == '__main__':
    unittest.main()
