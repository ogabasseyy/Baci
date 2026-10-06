import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


SPEC = importlib.util.spec_from_file_location(
    'wallet_gateway_database_preflight',
    Path(__file__).with_name('wallet-gateway-database-preflight.py'),
)
database = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(database)


class WalletDatabasePreflightTests(unittest.TestCase):
    def _output(self, boolean='true'):
        grants = [
            f'grant|{table}.{column}|{boolean}'
            for table, columns in (database.SUPPORTING_COLUMNS | database.REQUIRED_COLUMNS).items()
            for column in columns
        ]
        rls = [f'rls|{table}|true|true' for table in database.REQUIRED_COLUMNS]
        return '\n'.join([*grants, *rls, 'rpc|get_storefront_payment_settings|true'])

    def test_accepts_postgres_boolean_text_from_live_psql_output(self):
        result = SimpleNamespace(returncode=0, stdout=self._output(), stderr='')
        checked = database.check_docker_database(lambda *args, **kwargs: result)
        self.assertEqual(checked['databaseReadOnly'], True)
        self.assertEqual(checked['customerScopedWalletTables'], 4)

    def test_rejects_a_missing_authenticated_column_grant(self):
        result = SimpleNamespace(returncode=0, stdout=self._output('false'), stderr='')
        with self.assertRaisesRegex(database.Refused, 'authenticated_column_grants_missing'):
            database.check_docker_database(lambda *args, **kwargs: result)


if __name__ == '__main__':
    unittest.main()
