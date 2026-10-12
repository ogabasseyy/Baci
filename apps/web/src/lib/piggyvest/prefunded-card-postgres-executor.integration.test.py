import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import unittest


WEB = Path(__file__).resolve().parents[3]
STAGING = WEB.parents[1] / 'tools' / 'staging' / 'prefunded-card'
sys.path.insert(0, str(STAGING))
from runtime_configuration import build_runtime_configuration


BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
OPENSSL = Path('/opt/homebrew/bin/openssl')
HOST = 'executor.staging.example.test'
ROLES = {'worker': 'prefunded_treasury_operator', 'authorizer': 'prefunded_authorizer',
         'evidence': 'prefunded_evidence'}
PASSWORDS = {role: ('synthetic-scram-' + profile).ljust(64, 'x') for profile, role in ROLES.items()}
PINNED_SYSTEM = '7685292944002592802'


class PrefundedExecutorIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path('/private/tmp') / ('baci-prefunded-card-executor.' + secrets.token_hex(8))
        cls.root.mkdir(mode=0o700)
        cls.addClassCleanup(shutil.rmtree, cls.root)
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir()
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith(('PG', 'NODE_'))}
        for name in ('server', 'untrusted'):
            cls.command([OPENSSL, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
                         '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST,
                         '-addext', 'basicConstraints=critical,CA:TRUE',
                         '-keyout', cls.root / (name + '.key'), '-out', cls.root / (name + '.crt')], umask=0o077)
            if stat.S_IMODE((cls.root / (name + '.key')).stat().st_mode) != 0o600:
                raise RuntimeError('Synthetic TLS private key mode refused')
        cls.ca = (cls.root / 'server.crt').read_text()
        cls.wrong_ca = (cls.root / 'untrusted.crt').read_text()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        cls.command([BIN / 'initdb', '-D', cls.root / 'data', '-A', 'trust', '-U', 'harness_admin', '--no-locale'])
        (cls.root / 'data' / 'pg_hba.conf').write_text(
            'local all all trust\n'
            'hostssl prefunded_card_local ' + ','.join(ROLES.values()) + ' 127.0.0.1/32 scram-sha-256\n'
            'host all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
        cls.command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-l', cls.root / 'log', '-o',
                     f'-k {cls.socket} -h 127.0.0.1 -p {cls.port} -c ssl=on '
                     f'-c ssl_cert_file={cls.root}/server.crt -c ssl_key_file={cls.root}/server.key '
                     '-c password_encryption=scram-sha-256', 'start'])
        cls.addClassCleanup(cls.command, [BIN / 'pg_ctl', '-D', cls.root / 'data', '-m', 'immediate', 'stop'])
        cls.sql('CREATE DATABASE prefunded_card_local', database='postgres')
        cls.sql("""
          CREATE ROLE prefunded_treasury_ledger_worker NOLOGIN;
          CREATE ROLE prefunded_card_authorization_reader NOLOGIN;
          CREATE ROLE prefunded_card_authorization_provisioner NOLOGIN;
          CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT;
          CREATE ROLE prefunded_authorizer LOGIN NOINHERIT;
          CREATE ROLE prefunded_evidence LOGIN NOINHERIT;
          GRANT prefunded_treasury_ledger_worker,prefunded_card_authorization_reader TO prefunded_treasury_operator;
          GRANT prefunded_card_authorization_provisioner TO prefunded_authorizer;
          CREATE SCHEMA prefunded_card;
          CREATE FUNCTION prefunded_card.executor_system_identity() RETURNS jsonb
          LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
            SELECT jsonb_build_object('database',current_database(),'login',session_user,
              'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))
          $$;
          REVOKE ALL ON FUNCTION prefunded_card.executor_system_identity() FROM PUBLIC;
          GRANT USAGE ON SCHEMA prefunded_card TO prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
          GRANT EXECUTE ON FUNCTION prefunded_card.executor_system_identity()
            TO prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
        """)
        for role, password in PASSWORDS.items():
            cls.sql(f"ALTER ROLE {role} PASSWORD '{password}'")
        cls.system = cls.sql('SELECT system_identifier::text FROM pg_control_system()').stdout.strip()
        cls.dns = cls.root / 'loopback-dns.cjs'
        cls.dns.write_text("""
          const dns = require('node:dns');
          dns.lookup = (hostname, options, callback) => {
            if (typeof options === 'function') { callback = options; options = {}; }
            process.nextTick(() => {
              if (hostname !== 'executor.staging.example.test') {
                callback(Object.assign(new Error('Synthetic DNS refused'), { code: 'ENOTFOUND' }));
              } else if (options && options.all) {
                callback(null, [{ address: '127.0.0.1', family: 4 }]);
              } else { callback(null, '127.0.0.1', 4); }
            });
          };
        """)
        cls.compiled = cls.root / 'probe.cjs'
        cls.bundle(cls.compiled, source="""
          import { createPrefundedCardPostgresExecutor } from './src/lib/piggyvest/prefunded-card-postgres-executor';
          const execute = createPrefundedCardPostgresExecutor(JSON.parse(process.argv[2]));
          execute('SELECT true AS result', []).then(result => {
            process.stdout.write(JSON.stringify(result));
          }).catch(() => { process.stdout.write('refused'); process.exitCode = 1; });
        """)
        cls.cli = cls.root / 'readiness.cjs'
        cls.bundle(cls.cli, entry='../../tools/staging/prefunded-card/runtime-readiness-cli.ts')
        compiled = cls.cli.read_text()
        if compiled.count('"' + PINNED_SYSTEM + '"') != 3:
            raise RuntimeError('Synthetic CLI physical identity substitution drifted')
        cls.cli.write_text(compiled.replace('"' + PINNED_SYSTEM + '"', '"' + cls.system + '"'))
        cls.clock = cls.root / 'fixed-clock.cjs'
        cls.clock.write_text("""
          const OriginalDate = Date;
          globalThis.Date = class extends OriginalDate {
            constructor(...values) { super(...(values.length ? values : ['2026-09-27T12:00:00Z'])); }
            static now() { return new OriginalDate('2026-09-27T12:00:00Z').getTime(); }
          };
        """)
        configuration = build_runtime_configuration(
            json.loads((STAGING / 'activation-config.template.json').read_text()),
            cls.ca, 'test_key_synthetic', 'sk_test_synthetic', PASSWORDS)
        cls.config_path = cls.root / 'activation.json'
        cls.config_path.write_text(json.dumps(cls.synthetic_targets(configuration)))
        cls.config_path.chmod(0o600)

    @classmethod
    def bundle(cls, output, source=None, entry=None):
        arguments = ['pnpm', 'exec', 'esbuild', '--bundle', '--platform=node', '--target=node22', '--format=cjs',
                     '--conditions=react-server', '--external:pg-native', '--outfile=' + str(output)]
        if entry:
            arguments.append(entry)
        else:
            arguments.extend(['--loader=ts', '--sourcefile=src/lib/piggyvest/executor-integration-probe.ts'])
        cls.command(arguments, cwd=WEB, input=source)

    @classmethod
    def synthetic_targets(cls, value):
        if isinstance(value, dict):
            return {key: cls.synthetic_targets(item) for key, item in value.items()}
        if isinstance(value, list):
            return [cls.synthetic_targets(item) for item in value]
        substitutions = {PINNED_SYSTEM: cls.system, 'postgres': 'prefunded_card_local',
                         'piggyvest-db.staging.baci.internal': HOST, 5432: cls.port}
        return substitutions.get(value, value)

    @classmethod
    def command(cls, arguments, **kwargs):
        return subprocess.run([str(value) for value in arguments], env=cls.environment,
                              text=True, capture_output=True, timeout=60, check=True, **kwargs)

    @classmethod
    def sql(cls, statement, database='prefunded_card_local'):
        return cls.command([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1', '-h', cls.socket,
                            '-p', str(cls.port), '-U', 'harness_admin', '-d', database], input=statement)

    def execute(self, profile, system=None, tls=False, **overrides):
        configuration = dict(environment='staging', profile=profile, transport='local_test',
                             socketDirectory=str(self.socket), database='prefunded_card_local',
                             expectedDatabase='prefunded_card_local', port=self.port,
                             login=ROLES[profile], expectedLogin=ROLES[profile],
                             expectedSystemId=system or self.system, password='synthetic-local-only')
        if tls:
            configuration.pop('socketDirectory')
            configuration.update(transport='tls', host=HOST, expectedHost=HOST, certificateAuthority=self.ca,
                                 expectedProjectId='synthetic-project', actualProjectId='synthetic-project',
                                 storageApproved=True, password=PASSWORDS[ROLES[profile]])
        configuration.update(overrides)
        return subprocess.run(['node', '--require', str(self.dns), str(self.compiled), json.dumps(configuration)],
                              env=self.environment,
                              text=True, capture_output=True, timeout=10)

    def test_readiness_executes_real_catalog_query_for_all_three_restricted_profiles(self):
        for profile in ROLES:
            with self.subTest(profile=profile):
                result = self.execute(profile)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout), {'rows': [{'result': True}]})

    def test_tls_scram_readiness_for_all_three_profiles(self):
        state = self.sql("""SELECT current_setting('ssl') = 'on' AND
          (SELECT count(*) = 3 AND bool_and(rolpassword LIKE 'SCRAM-SHA-256$%') FROM pg_authid
            WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')) AND
          (SELECT count(*) = 1 FROM pg_hba_file_rules
            WHERE type='hostssl' AND auth_method='scram-sha-256' AND address='127.0.0.1' AND error IS NULL);""")
        self.assertEqual(state.stdout.strip(), 't')
        for profile in ROLES:
            with self.subTest(profile=profile):
                result = self.execute(profile, tls=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout), {'rows': [{'result': True}]})

    def test_tls_refuses_wrong_ca_and_wrong_password_for_each_profile(self):
        for profile in ROLES:
            for failure, override in (('ca', dict(certificateAuthority=self.wrong_ca)),
                                      ('password', dict(password='synthetic-incorrect-password'))):
                with self.subTest(profile=profile, failure=failure):
                    result = self.execute(profile, tls=True, **override)
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, 'refused')
                    self.assertEqual(result.stderr, '')

    def test_complete_cli_connect_does_not_reparse_injected_profile_fields(self):
        arguments = ['node', '--require', str(self.dns), '--require', str(self.clock), str(self.cli)]
        checked = subprocess.run([*arguments, '--check', str(self.config_path)], env=self.environment,
                                 text=True, capture_output=True, timeout=20)
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
        self.assertEqual(json.loads(checked.stdout),
                         dict(status='configuration-checked', databaseContacted=False, cardPaymentsEnabled=False))
        connected = subprocess.run([*arguments, '--connect', str(self.config_path)], env=self.environment,
                                   text=True, capture_output=True, timeout=20)
        self.assertEqual(connected.returncode, 0, connected.stdout + connected.stderr)
        self.assertEqual(json.loads(connected.stdout),
                         dict(status='restricted-tls-ready', profiles=['worker', 'authorizer', 'evidence'],
                              readOnly=True, cardPaymentsEnabled=False))

    def test_wrong_physical_database_and_extra_membership_still_refuse(self):
        self.assertNotEqual(self.execute('worker', system='1').returncode, 0)
        self.sql('CREATE ROLE unexpected_parent NOLOGIN; GRANT unexpected_parent TO prefunded_evidence;')
        try:
            self.assertNotEqual(self.execute('evidence').returncode, 0)
        finally:
            self.sql('REVOKE unexpected_parent FROM prefunded_evidence; DROP ROLE unexpected_parent;')


if __name__ == '__main__':
    unittest.main()
