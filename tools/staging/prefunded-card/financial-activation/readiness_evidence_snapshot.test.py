import copy
import json
import unittest

import readiness_evidence_snapshot as snapshot


def configuration():
    return {'scope': {'integrationId': snapshot.INTEGRATION, 'merchantId': snapshot.MERCHANT},
        'verifier': {'environment': 'staging', 'systemIdentifier': snapshot.SYSTEM,
            'treasuryBindingId': snapshot.TREASURY, 'expectedBusinessId': snapshot.BUSINESS,
            'sourceWalletId': snapshot.SOURCE, 'expiresAt': snapshot.DEADLINE},
        'database': {'environment': 'staging', 'transport': 'tls', 'host': snapshot.HOST,
            'expectedHost': snapshot.HOST, 'port': 5432, 'login': 'prefunded_snapshot_verifier',
            'expectedLogin': 'prefunded_snapshot_verifier', 'database': 'postgres',
            'expectedDatabase': 'postgres', 'expectedSystemId': snapshot.SYSTEM,
            'password': 's' * 64, 'certificateAuthority': 'synthetic-test-ca'}}


class SnapshotTlsTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.identity = {'State': {'Running': True}, 'Config': {'Labels': {
            'com.docker.compose.project': 'baci-isolated-savings'}}, 'NetworkSettings': {
            'Networks': {snapshot.NETWORK: {'IPAddress': snapshot.ADDRESS}}}}
        self.session = {'login': 'prefunded_snapshot_verifier', 'database': 'postgres',
            'address': snapshot.ADDRESS, 'readOnly': True, 'tls': True,
            'roleSafe': True, 'membershipSafe': True}
        self.binding = {'bindingVerified': True}

    def execute(self, args, input_text=None, extra_env=None):
        self.events.append((args, input_text, extra_env))
        if 'inspect' in args:
            return json.dumps([self.identity])
        if '/bin/cat' in args:
            return configuration()['database']['certificateAuthority']
        return json.dumps(self.session if extra_env else self.binding)

    def test_snapshot_probe_only_reads_and_keeps_password_out_of_command_arguments(self):
        result = snapshot.collect(configuration(), '/etc/baci/snapshot-ca.pem', self.execute)
        self.assertEqual(result, {'snapshotTlsIdentityVerified': True})
        for args, sql, environment in self.events:
            self.assertNotIn('s' * 64, ' '.join(args))
            if sql:
                self.assertIn('BEGIN READ ONLY', sql)
                self.assertNotIn('record_scoped_treasury_snapshot(', sql)
                self.assertNotIn('verify_snapshot_binding(', sql)
            if environment:
                self.assertEqual(environment['PGSSLMODE'], 'verify-full')
                self.assertEqual(environment['PGHOST'], snapshot.HOST)
        self.assertNotIn('s' * 64, json.dumps(result))

    def test_expired_scope_or_wrong_database_identity_refuses_before_command(self):
        for key, value in (('expectedSystemId', 'another'), ('login', 'postgres')):
            source = configuration()
            source['database'][key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                snapshot.collect(source, '/etc/ca.pem', self.execute)
        source = configuration()
        source['verifier']['expiresAt'] = '2026-09-29T15:59:10Z'
        with self.assertRaises(Exception):
            snapshot.collect(source, '/etc/ca.pem', self.execute)
        self.assertEqual(self.events, [])

    def test_wrong_endpoint_tls_or_missing_binding_never_passes(self):
        original = copy.deepcopy(self.session)
        for key, value in (('tls', False), ('address', '127.0.0.1'), ('membershipSafe', False), ('roleSafe', False)):
            self.session = {**original, key: value}
            with self.subTest(key=key), self.assertRaises(Exception):
                snapshot.collect(configuration(), '/etc/ca.pem', self.execute)
        self.session = original
        self.binding = {'bindingVerified': False}
        with self.assertRaises(Exception):
            snapshot.collect(configuration(), '/etc/ca.pem', self.execute)

    def test_unapproved_ca_or_database_network_is_refused(self):
        self.identity['NetworkSettings']['Networks'][snapshot.NETWORK]['IPAddress'] = '172.23.0.3'
        with self.assertRaises(Exception):
            snapshot.collect(configuration(), '/etc/ca.pem', self.execute)
        self.assertEqual(len(self.events), 1)


if __name__ == '__main__':
    unittest.main()
