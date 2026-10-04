import importlib.util
import json
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
FENCE = HERE.parent / 'replay-claim-fence'
RECEIPT = '0f9938ae-8551-4e2e-8816-853e0231b2c3'
SYNTHETIC_RECEIPT = '20000000-0000-4000-8000-000000000002'


class ReceiptReportTests(unittest.TestCase):
    def test_real_postgres_report_links_signature_without_claiming_or_changing_receipt(self):
        specification = importlib.util.spec_from_file_location('receipt_fixture', FENCE / 'postgres.test.py')
        fixture = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(fixture)
        cases = fixture.ClaimFencePostgresTests
        cases.setUpClass()
        case = cases('test_fixture_definition_matches_parent_live_definition_pin')
        try:
            case.setUp()
            case.fixture()
            case.sql('CREATE TABLE public.piggyvest_staging_receipt_signatures('
                     'receipt_id uuid PRIMARY KEY,payload_sha256 text,provider_signature text);')
            case.sql("INSERT INTO public.piggyvest_staging_receipt_signatures VALUES('" + SYNTHETIC_RECEIPT
                     + "','synthetic-sealed-digest','synthetic-provider-signature');")
            system = case.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
            source = (HERE / 'receipt_report.sql').read_text()
            source = source.replace('7686901100561231906', system).replace(RECEIPT, SYNTHETIC_RECEIPT)
            source = source.replace("session_user<>'supabase_admin'", "session_user<>'postgres'")
            source = source.replace("current_database()<>'postgres'", "current_database()<>'" + case.database + "'")
            before = case.rows()
            sequence = case.probe()
            report = json.loads(case.sql(source).stdout)
            self.assertTrue(report['identity']['readOnly'])
            self.assertTrue(report['identity']['localUnix'])
            self.assertEqual(report['receiptId'], SYNTHETIC_RECEIPT)
            self.assertEqual(report['receiptCount'], 1)
            self.assertEqual(report['signatureCount'], 1)
            self.assertTrue(report['signaturePreserved'])
            self.assertTrue(report['signedPayloadHashMatches'])
            self.assertFalse(report['claimTokenPresent'])
            self.assertEqual(report['providerSignature'], 'synthetic-provider-signature')
            self.assertEqual(report['sealed']['ciphertext'], 'synthetic-ciphertext')
            self.assertEqual(case.rows(), before)
            self.assertEqual(case.probe(), sequence)
            case.sql("UPDATE public.piggyvest_staging_receipt_signatures SET payload_sha256='foreign';")
            report = json.loads(case.sql(source).stdout)
            self.assertFalse(report['signedPayloadHashMatches'])
            case.sql('DELETE FROM public.piggyvest_staging_receipt_signatures;')
            report = json.loads(case.sql(source).stdout)
            self.assertFalse(report['signaturePreserved'])
            self.assertEqual(report['signatureCount'], 0)
        finally:
            case.doCleanups()
            cases.tearDownClass()


if __name__ == '__main__':
    unittest.main()
