import copy
import subprocess
import unittest

import public_service_contract as contract
import runtime_scheduler as workers


DIGEST = 'a' * 64
IMAGE_ENVIRONMENT = ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=24.18.0']


class PublicServiceContractTests(unittest.TestCase):
    def observed(self):
        value = contract.container_contract(DIGEST)
        value['Config']['Env'] = list(IMAGE_ENVIRONMENT)
        return value

    def test_fixed_image_nonroot_readonly_and_loopback_only(self):
        value = self.observed()
        self.assertEqual(contract.IMAGE, workers.IMAGE)
        self.assertEqual(contract.NETWORKS, workers.NETWORKS)
        self.assertEqual(contract.HOST, workers.HOST)
        self.assertEqual(value['Image'], workers.IMAGE)
        self.assertEqual(value['Config']['User'], '65530:65530')
        self.assertEqual(value['Config']['WorkingDir'], '/app/apps/web')
        self.assertEqual(value['Config']['Cmd'], ['/usr/local/bin/node', '/app/launch-public.cjs'])
        self.assertTrue(value['HostConfig']['ReadonlyRootfs'])
        self.assertFalse(value['HostConfig']['Privileged'])
        self.assertEqual(value['HostConfig']['CapDrop'], ['ALL'])
        self.assertEqual(value['HostConfig']['SecurityOpt'], ['no-new-privileges'])
        self.assertEqual(value['HostConfig']['RestartPolicy'], {'Name': 'no', 'MaximumRetryCount': 0})
        self.assertEqual(value['HostConfig']['PortBindings'], {
            '3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '4800'}]})
        contract.validate_container(value, DIGEST, IMAGE_ENVIRONMENT)

    def test_mounts_only_immutable_app_and_two_projected_configs(self):
        mounts = self.observed()['Mounts']
        self.assertEqual(mounts, [
            dict(Type='bind', Source='/opt/baci-prefunded-public/app', Destination='/app', RW=False),
            dict(Type='bind', Source='/opt/baci-prefunded-public/config/checkout.json',
                 Destination='/run/pvb-public/checkout.json', RW=False),
            dict(Type='bind', Source='/opt/baci-prefunded-public/config/anon.json',
                 Destination='/run/pvb-public/anon.json', RW=False),
        ])
        for forbidden in ('activation.prepared', 'background', 'snapshot', 'replay', '/var/run/docker.sock'):
            self.assertNotIn(forbidden, str(mounts))
        self.assertEqual(contract.APPROVED_BUDGET_KOBO, 10000)
        self.assertEqual(contract.PRESERVED_PRINCIPAL_KOBO, 10000)
        self.assertEqual(contract.DEADLINE, '2026-09-29T15:59:10Z')

    def test_create_does_not_start_or_enable_and_publishes_exactly_one_port(self):
        arguments = contract.create_arguments(DIGEST)
        self.assertEqual(arguments[0], 'create')
        self.assertIn('--name=baci-prefunded-public', arguments)
        self.assertIn('--publish=127.0.0.1:4800:3000/tcp', arguments)
        self.assertEqual(sum(value.startswith('--publish') for value in arguments), 1)
        self.assertIn('--restart=no', arguments)
        self.assertIn('--workdir=/app/apps/web', arguments)
        self.assertIn('--network=' + workers.NETWORKS[0], arguments)
        self.assertIn('--add-host=' + workers.HOST, arguments)
        self.assertEqual(sum(value.startswith('--mount=') for value in arguments), 3)
        self.assertTrue(all(value.endswith(',readonly') for value in arguments if value.startswith('--mount=')))
        self.assertFalse(any(value.startswith(('--env', '--volume', '--privileged')) for value in arguments))
        self.assertEqual(arguments[-3:], [contract.IMAGE, '/usr/local/bin/node', '/app/launch-public.cjs'])

    def test_rejects_privilege_network_port_identity_and_secret_mount_drift(self):
        changes = [
            ('Config', 'User', '0:0'), ('Config', 'Cmd', ['/bin/sh']),
            ('Config', 'WorkingDir', '/'), ('Config', 'Entrypoint', ['/bin/sh']),
            ('HostConfig', 'Privileged', True), ('HostConfig', 'ReadonlyRootfs', False),
            ('HostConfig', 'CapAdd', ['SYS_ADMIN']), ('HostConfig', 'CapDrop', []),
            ('HostConfig', 'SecurityOpt', []), ('HostConfig', 'NetworkMode', 'host'),
            ('HostConfig', 'PidMode', 'host'), ('HostConfig', 'IpcMode', 'host'),
            ('HostConfig', 'Binds', ['/etc:/etc:ro']), ('HostConfig', 'Devices', [{}]),
            ('HostConfig', 'PortBindings', {'3000/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '4800'}]}),
            ('HostConfig', 'PublishAllPorts', True), ('HostConfig', 'ExtraHosts', []),
            ('HostConfig', 'RestartPolicy', {'Name': 'always', 'MaximumRetryCount': 0}),
            ('HostConfig', 'Tmpfs', {'/etc': 'rw'}),
        ]
        for section, key, replacement in changes:
            observed = self.observed()
            observed[section][key] = replacement
            with self.subTest(section=section, key=key), self.assertRaises(contract.Refused):
                contract.validate_container(observed, DIGEST, IMAGE_ENVIRONMENT)
        for changed in ('name', 'image', 'mount', 'write', 'network', 'label'):
            observed = self.observed()
            if changed == 'name':
                observed['Name'] = '/foreign'
            elif changed == 'image':
                observed['Image'] = 'foreign'
            elif changed == 'mount':
                observed['Mounts'].append(dict(Type='bind', Source='/etc', Destination='/secret', RW=False))
            elif changed == 'write':
                observed['Mounts'][1]['RW'] = True
            elif changed == 'network':
                observed['NetworkSettings']['Networks']['unreviewed'] = {}
            else:
                observed['Config']['Labels'][contract.LABEL] = 'b' * 64
            with self.subTest(changed=changed), self.assertRaises(contract.Refused):
                contract.validate_container(observed, DIGEST, IMAGE_ENVIRONMENT)

    def test_requires_exact_environment_from_independently_inspected_pinned_image(self):
        for extra in ('PREFUNDED_CARD_PUBLIC_ENABLED=true', 'PAYSTACK_SECRET_KEY=synthetic',
                      'NODE_OPTIONS=--require=/unreviewed', 'PVB_SECRET_KEY=synthetic'):
            observed = self.observed()
            observed['Config']['Env'].append(extra)
            with self.subTest(extra=extra), self.assertRaises(contract.Refused):
                contract.validate_container(observed, DIGEST, IMAGE_ENVIRONMENT)
        for missing in ({}, None, {'Config': {}}, []):
            with self.subTest(missing=missing), self.assertRaises(contract.Refused):
                contract.validate_container(missing, DIGEST, IMAGE_ENVIRONMENT)
        with self.assertRaises(contract.Refused):
            contract.validate_container(self.observed(), DIGEST, None)

    def test_units_expire_at_fixed_deadline_and_never_autostart(self):
        units = contract.units()
        self.assertEqual(set(units), {'baci-prefunded-public.service',
            'baci-prefunded-public-deadline.service', 'baci-prefunded-public-deadline.timer'})
        combined = '\n'.join(units.values())
        self.assertNotIn('[Install]', combined)
        self.assertNotIn('WantedBy=', combined)
        self.assertIn('Restart=no', units['baci-prefunded-public.service'])
        self.assertIn('baci-prefunded-public-deadline.timer', units['baci-prefunded-public.service'])
        self.assertIn('OnCalendar=2026-09-29 15:59:10 UTC', units['baci-prefunded-public-deadline.timer'])
        self.assertIn('Persistent=true', units['baci-prefunded-public-deadline.timer'])
        self.assertIn('ExecStopPost=', units['baci-prefunded-public.service'])
        guard = next(line for line in combined.splitlines() if line.startswith('ExecCondition='))
        self.assertIn('1790697550', guard)
        shell = guard.split("'", 2)[1].replace('%%s', '%s')
        for timestamp, expected in ((1790697549, 0), (1790697550, 1), (1790697551, 1)):
            script = shell.replace('$(/bin/date -u +%s)', str(timestamp))
            result = subprocess.run(['/bin/sh', '-c', script], capture_output=True, timeout=2)
            self.assertEqual(result.returncode, expected)

    def test_rollback_and_deadline_stop_only_public_service_and_container(self):
        commands = contract.rollback_commands()
        self.assertEqual(commands, [
            ['/usr/bin/systemctl', 'stop', 'baci-prefunded-public.service'],
            ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'stop', '--time', '5', 'baci-prefunded-public'],
        ])
        deadline = contract.units()['baci-prefunded-public-deadline.service']
        self.assertIn('ExecStart=' + ' '.join(commands[0]), deadline)
        self.assertIn('ExecStart=' + ' '.join(commands[1]), deadline)
        for forbidden in ('background', 'snapshot', 'replay', 'psql', 'rm ', 'disable', 'enable'):
            self.assertNotIn(forbidden, deadline + str(commands))

    def test_unauthenticated_probes_never_submit_a_charge_or_expose_saved_card(self):
        probes = contract.probe_contract()
        self.assertEqual(dict(contract.PROBE_HEADERS), {'Host': 'staging.ogabassey.com', 'Connection': 'close'})
        checkout = '/api/storefront/customer/savings/card-checkout'
        saved = '/api/storefront/customer/savings/card-contributions'
        self.assertIn(('GET', checkout + '?goalId=430314fd-cd8b-4579-98d4-e9f345713dd6', 401), probes)
        self.assertIn(('POST', checkout, 401), probes)
        self.assertIn(('PATCH', checkout, 401), probes)
        self.assertIn(('PUT', checkout, 405), probes)
        self.assertIn(('GET', saved, 404), probes)
        self.assertIn(('POST', saved, 404), probes)
        self.assertIn(('GET', '/api/csrf', 200), probes)
        self.assertIn(('POST', '/api/csrf', 405), probes)
        self.assertIn(('GET', '/savings/card-return', 200), probes)
        self.assertIn(('HEAD', '/savings/card-return', 200), probes)
        self.assertEqual(len(probes), 10)

    def test_refuses_manifest_injection_and_returns_independent_values(self):
        for digest in (None, '', DIGEST.upper(), DIGEST + ';true', '0' * 63):
            with self.subTest(digest=digest), self.assertRaises(contract.Refused):
                contract.create_arguments(digest)
        original = contract.container_contract(DIGEST)
        changed = copy.deepcopy(original)
        changed['Mounts'].clear()
        self.assertEqual(contract.container_contract(DIGEST), original)


if __name__ == '__main__':
    unittest.main()
