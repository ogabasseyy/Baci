import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load_module(name, filename):
    specification = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


OWNER = load_module('history_owner_sql', 'legacy-history-owner.py')
FIXTURE = load_module('history_owner_fixture', 'legacy-enrollment-local.test.py')


class OwnerSqlTransport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        FIXTURE.LegacyEnrollment.setUpClass()

    @classmethod
    def tearDownClass(cls):
        FIXTURE.LegacyEnrollment.tearDownClass()

    def test_flattened_owner_sql_over_stdin_preserves_the_plan_and_retries_once(self):
        fixture = FIXTURE.LegacyEnrollment()
        proof = fixture.proof()
        filenames = (
            'legacy-enrollment-candidate.sql', 'legacy-enrollment-scope-preflight.sql',
            'legacy-enrollment-preflight.sql',
        )
        flattened = OWNER.flatten_sql({name: (HERE / name).read_bytes() for name in filenames})
        OWNER.validate_sql_pins(flattened)
        parameters = {
            'legacy_enrollment_test': 'on',
            'legacy_enrollment_system': fixture.database.system,
            'legacy_enrollment_business': 'business',
            'legacy_enrollment_merchant': FIXTURE.MERCHANT,
            'legacy_enrollment_customer': FIXTURE.CUSTOMER,
            'legacy_enrollment_goal': FIXTURE.GOAL,
            'legacy_enrollment_wallet': 'scratch-private-wallet',
            'legacy_enrollment_provider_customer': 'scratch-event-customer',
        }
        sql = '\n'.join(f'\\set {key} {value}' for key, value in parameters.items())
        sql += '\n' + OWNER.inject_proof(flattened, proof)
        command = [str(FIXTURE.MODULE.BIN / 'psql'), '-X', '-w', '-qAt',
                   '-h', str(fixture.database.path), '-p', '55461', '-U', 'harness_admin',
                   '-d', 'piggyvest_legacy_enrollment_scratch', '-v', 'ON_ERROR_STOP=1']
        for marker in ('migrated', 'already_complete'):
            result = subprocess.run(command, input=sql, text=True, capture_output=True,
                                    timeout=30, env=fixture.database.environment, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip().splitlines()[-1], marker)
        self.assertEqual(fixture.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '1')
        self.assertEqual(fixture.sql('SELECT count(*) FROM public.customer_savings_contributions'), '1')
        self.assertEqual(fixture.sql('SELECT current_amount FROM public.customer_savings_goals'), '100.00')


if __name__ == '__main__':
    unittest.main()
