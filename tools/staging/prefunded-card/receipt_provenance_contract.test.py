from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).parent))
import receipt_provenance_contract as CONTRACT


class ReceiptContract(unittest.TestCase):
    def fixture(self):
        return dict(Image=CONTRACT.IMAGE, State={'Running': True},
                    Config={'User': '65532:65532', 'Cmd': ['node', '/app/intake-server.mjs']},
                    Mounts=[dict(Source=CONTRACT.SERVER, Destination='/app/intake-server.mjs', RW=False, Type='bind'),
                            dict(Source=CONTRACT.DIRECTORY + '/intake-config.json',
                                 Destination='/run/pvb-intake/config.json', RW=False, Type='bind')],
                    HostConfig=dict(ReadonlyRootfs=True, Privileged=False, CapDrop=['ALL'],
                                    SecurityOpt=['no-new-privileges:true'],
                                    PortBindings={'4791/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '4791'}]}),
                    NetworkSettings={'Networks': {'pvb-staging-intake-ingress': {}, 'pvb-staging-receipts': {}}})

    def test_exact_container_and_refusal_of_elevated_or_public_variants(self):
        CONTRACT.validate_container(self.fixture())
        variants = []
        for section, name, value in [('Config', 'User', '0:0'), ('State', 'Running', False),
                                     ('HostConfig', 'Privileged', True), ('HostConfig', 'CapDrop', []),
                                     ('HostConfig', 'ReadonlyRootfs', False),
                                     ('HostConfig', 'SecurityOpt', []),
                                     ('HostConfig', 'PortBindings', {'4791/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '4791'}]})]:
            candidate = self.fixture()
            candidate[section][name] = value
            variants.append(candidate)
        candidate = self.fixture()
        candidate['Mounts'][0]['RW'] = True
        variants.append(candidate)
        candidate = self.fixture()
        candidate['NetworkSettings']['Networks']['production'] = {}
        variants.append(candidate)
        for candidate in variants:
            with self.subTest(candidate=candidate):
                with self.assertRaises(CONTRACT.Refused):
                    CONTRACT.validate_container(candidate)

    def test_closed_manifest_rejects_extra_missing_or_modified_payloads(self):
        contents = {name: name.encode() for name in CONTRACT.FILES}
        manifest = {name: hashlib.sha256(value).hexdigest() for name, value in contents.items()}
        self.assertEqual(CONTRACT.validate_manifest(manifest, contents.__getitem__), contents)
        for candidate in [{**manifest, 'unexpected': 'a' * 64}, {},
                          {**manifest, CONTRACT.FILES[0]: 'a' * 64}]:
            with self.assertRaises(CONTRACT.Refused):
                CONTRACT.validate_manifest(candidate, contents.__getitem__)

    @unittest.skipUnless(os.environ.get('BACI_RECEIPT_SOURCE_ROOT'), 'Set approved receiver source root for disposable SQL rehearsal')
    def test_installed_schema_matches_contract_and_drift_is_refused(self):
        source = Path(os.environ['BACI_RECEIPT_SOURCE_ROOT'])
        binary = Path('/opt/homebrew/opt/postgresql@18/bin')
        environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        with tempfile.TemporaryDirectory(prefix='baci-signature-owner-') as temporary:
            directory = Path(temporary)
            data = directory / 'data'

            def run(arguments, **options):
                return subprocess.run([str(value) for value in arguments], capture_output=True,
                                      text=True, check=True, timeout=60, env=environment, **options)

            run([binary / 'initdb', '-D', data, '-U', 'supabase_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
            run([binary / 'pg_ctl', '-D', data, '-l', directory / 'postgres.log', '-o', f"-h '' -k {directory}", '-w', 'start'])
            try:
                command = [binary / 'psql', '-XqAt', '-h', directory, '-U', 'supabase_admin', '-d', 'postgres',
                           '-v', 'ON_ERROR_STOP=1']
                query = lambda sql: run(command, input=sql).stdout.strip()
                query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator NOINHERIT;')
                identifier = query('SELECT system_identifier FROM pg_control_system();')
                self.assertNotEqual(identifier, CONTRACT.SYSTEM)
                for name in ['ingest-storage.sql', 'replay-storage.sql']:
                    run([*command, '-v', 'expected_system_identifier=' + identifier], input=(source / name).read_text())
                query((source / 'replay-runtime-storage.sql').read_text().replace(CONTRACT.SYSTEM, identifier))
                before = json.loads(query(CONTRACT.schema_query()))
                self.assertFalse(before['table'])
                schema = (source / 'receipt-signature-storage.sql').read_text()
                run([*command, '-v', 'expected_system_identifier=' + identifier], input=schema)
                original_system = CONTRACT.SYSTEM
                CONTRACT.SYSTEM = identifier
                try:
                    observed = json.loads(query(CONTRACT.schema_query()))
                    self.assertTrue(CONTRACT.validate_schema(observed, schema))
                    for field in ['safeTable', 'safeRoles', 'safeGrants']:
                        altered = deepcopy(observed)
                        altered[field] = False
                        with self.assertRaises(CONTRACT.Refused):
                            CONTRACT.validate_schema(altered, schema)
                    query('GRANT EXECUTE ON FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid) TO PUBLIC;')
                    with self.assertRaises(CONTRACT.Refused):
                        CONTRACT.validate_schema(json.loads(query(CONTRACT.schema_query())), schema)
                finally:
                    CONTRACT.SYSTEM = original_system
            finally:
                run([binary / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])


if __name__ == '__main__':
    unittest.main()
