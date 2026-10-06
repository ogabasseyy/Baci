#!/usr/bin/env python3
"""Tests for the fixed-deadline hosted-funding transition activator."""

import contextlib
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


activator = _load('funding-gateway-transition-activator')
candidate = _load('funding-gateway-transition-candidate')

LEASE_NOT_BEFORE = '2026-09-22T15:59:10.442Z'
LEASE_EXPIRES_AT = '2026-09-29T15:59:10.442Z'


def _binding(routes):
    return {
        'version': 1,
        'identity': {
            'host': 'staging-auth.ogabassey.com',
            'containers': {'auth': {'id': 'a' * 64, 'ip': '172.23.0.3', 'endpointId': 'b' * 64}},
            'networks': {'database': {'id': 'c' * 64, 'subnet': '172.23.0.0/16'}},
            'restRoutes': [
                {'path': path, 'methods': list(methods)} for path, methods in routes
            ],
        },
        'reviewedAt': LEASE_NOT_BEFORE,
        'leaseNotBefore': LEASE_NOT_BEFORE,
        'leaseExpiresAt': LEASE_EXPIRES_AT,
    }


def _compact(value):
    return json.dumps(value, separators=(',', ':')).encode()


class ActivatorContractTest(unittest.TestCase):
    def test_current_routes_are_first_five_of_candidate(self):
        self.assertEqual(tuple(activator.CURRENT_ROUTES), tuple(candidate.ROUTES[:5]))
        self.assertEqual(len(candidate.ROUTES), 11)

    def test_graph_and_routes_match_recovery_runner(self):
        text = (HERE / 'funding-gateway-recovery-runner.mjs').read_text()
        graph = {}
        for match in re.finditer(
            r'(?:\[`([^`]+)`\]|\'([^\']+)\')\s*:\s*\'([a-f0-9]{64})\'', text
        ):
            raw = (match.group(1) or match.group(2)).replace(
                '${code}', '/opt/baci-savings-gateway'
            )
            graph[raw] = match.group(3)
        self.assertEqual(graph, activator.GRAPH)

        def routes(block):
            parsed = []
            for path, methods in re.findall(
                r"\{\s*path:\s*'([^']+)'\s*,\s*methods:\s*\[([^\]]*)\]\s*\}",
                block,
            ):
                parsed.append(
                    (
                        path,
                        tuple(
                            piece.strip().strip("'")
                            for piece in methods.split(',')
                        ),
                    )
                )
            return tuple(parsed)

        pre, _, post = text.partition('const transitionedRoutes')
        self.assertEqual(routes(pre), tuple(activator.CURRENT_ROUTES))
        self.assertEqual(routes(post), tuple(candidate.ROUTES))

    def test_validate_current_binding_accepts_only_pre_transition(self):
        identity = activator.validate_current_binding(_binding(activator.CURRENT_ROUTES))
        self.assertEqual(identity['host'], 'staging-auth.ogabassey.com')
        with self.assertRaisesRegex(activator.Refused, 'pre-transition'):
            activator.validate_current_binding(_binding(candidate.ROUTES))
        widened = _binding(activator.CURRENT_ROUTES)
        widened['identity']['restRoutes'].append(
            {'path': '/rest/v1/rpc/funding', 'methods': ['POST']}
        )
        with self.assertRaisesRegex(activator.Refused, 'pre-transition'):
            activator.validate_current_binding(widened)
        moved = _binding(activator.CURRENT_ROUTES)
        moved['leaseExpiresAt'] = '2026-09-30T15:59:10.442Z'
        with self.assertRaisesRegex(activator.Refused, 'fixed deadline'):
            activator.validate_current_binding(moved)

    def _fake_builder(self):
        return SimpleNamespace(
            ROUTES=candidate.ROUTES,
            collect_transition_source=lambda: {
                'preRenewalManifestSha256': 'a' * 64,
                'archive': {
                    'name': 'approved-renewal',
                    'bindingSha256': 'e' * 64,
                    'startupEvidenceSha256': 'f' * 64,
                },
                'unitSha256': 'b' * 64,
            },
            render_owner_inputs=candidate.render_owner_inputs,
            render_post_renewal_manifest=candidate.render_post_renewal_manifest,
        )

    def test_build_package_is_deterministic_route_swap(self):
        current = _binding(activator.CURRENT_ROUTES)
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / 'one'
            first.mkdir()
            second = Path(tmp) / 'two'
            second.mkdir()
            outputs = []
            for cwd in (first, second):
                here = os.getcwd()
                os.chdir(cwd)
                try:
                    with (
                        patch.object(
                            activator, '_read_json', return_value=(current, b'{}')
                        ),
                        patch.object(
                            activator, '_load_pinned_candidate',
                            return_value=self._fake_builder(),
                        ),
                    ):
                        outputs.append(activator.build_package())
                finally:
                    os.chdir(here)
            pins = (
                'bindingSha256', 'manifestSha256', 'ownerInputsSha256',
                'postRenewalManifestSha256',
            )
            self.assertEqual(
                {k: outputs[0][k] for k in pins},
                {k: outputs[1][k] for k in pins},
            )
            package = first / 'funding-transition-package'
            manifest = json.loads((package / 'manifest.json').read_bytes())
            packaged = json.loads((package / 'binding.json').read_bytes())
            owner_inputs = json.loads((package / 'owner-inputs.json').read_bytes())
            post_renewal = json.loads((package / 'post-renewal-manifest.json').read_bytes())
            self.assertEqual(manifest['files']['binding.json'], outputs[0]['bindingSha256'])
            self.assertEqual(
                [(r['path'], tuple(r['methods'])) for r in packaged['identity']['restRoutes']],
                list(candidate.ROUTES),
            )
            self.assertEqual(
                [(r['path'], tuple(r['methods'])) for r in owner_inputs['identity']['restRoutes']],
                list(candidate.ROUTES),
            )
            self.assertEqual(owner_inputs['packageManifestSha256'], outputs[0]['manifestSha256'])
            self.assertEqual(
                owner_inputs['postRenewalManifestSha256'],
                outputs[0]['postRenewalManifestSha256'],
            )
            self.assertEqual(post_renewal['files']['managed-gateway.service'], 'b' * 64)
            for key in ('version', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'):
                self.assertEqual(packaged[key], current[key])
            self.assertEqual(
                {k: v for k, v in packaged['identity'].items() if k != 'restRoutes'},
                {k: v for k, v in current['identity'].items() if k != 'restRoutes'},
            )

    def test_build_package_refuses_existing_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            here = os.getcwd()
            os.chdir(tmp)
            try:
                Path('funding-transition-package').mkdir()
                with patch.object(
                    activator, '_read_json', return_value=(_binding(activator.CURRENT_ROUTES), b'{}')
                ):
                    with self.assertRaisesRegex(activator.Refused, 'already exists'):
                        activator.build_package()
            finally:
                os.chdir(here)

    def test_pinned_candidate_refuses_drift_or_malformed_routes(self):
        widened = SimpleNamespace(
            ROUTES=tuple(candidate.ROUTES) + (('/rest/v1/rpc/evil', ('POST',)),)
        )
        with patch.object(activator, '_load_candidate', return_value=widened):
            with self.assertRaisesRegex(activator.Refused, 'drifted'):
                activator._load_pinned_candidate()
        malformed = SimpleNamespace(ROUTES=(('/rest/v1/x', 'POST'),))
        with patch.object(activator, '_load_candidate', return_value=malformed):
            with self.assertRaisesRegex(activator.Refused, 'malformed'):
                activator._load_pinned_candidate()


class ActivatorFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.current = _binding(activator.CURRENT_ROUTES)
        self.packaged = activator.render_transition_binding(self.current, candidate.ROUTES)
        self.manifest = json.loads(
            activator.render_package_manifest(
                _compact(self.packaged), candidate.ROUTES
            ).decode()
        )
        self.preflight = {
            'identity': {
                'restRoutes': [
                    {'path': path, 'methods': list(methods)}
                    for path, methods in candidate.ROUTES
                ]
            }
        }
        self.fake_candidate = SimpleNamespace(
            ROUTES=candidate.ROUTES,
            STATE_DIRECTORY=self.root / 'state',
            PROVENANCE_PATH=self.root / 'state' / 'funding-transition-receipt.json',
            PACKAGE_MANIFEST_PATH=self.root / 'manifest.json',
            validate_preflight=lambda: self.preflight,
            render_provenance=candidate.render_provenance,
        )

    def test_validate_package_accepts_exact_swap(self):
        reads = {
            self.fake_candidate.PACKAGE_MANIFEST_PATH: (
                self.manifest,
                _compact(self.manifest),
            ),
        }

        def fake_json(path, owner_uid, modes):
            return reads[Path(path)]

        with (
            patch.object(activator, '_read_json', side_effect=fake_json),
            patch.object(activator, '_read_root_file', return_value=_compact(self.packaged)),
        ):
            packaged, raw = activator._validate_package(
                self.fake_candidate, self.current, self.preflight
            )
        self.assertEqual(packaged, self.packaged)
        self.assertEqual(raw, _compact(self.packaged))

    def test_validate_package_refuses_any_drift(self):
        reads = {
            self.fake_candidate.PACKAGE_MANIFEST_PATH: (
                self.manifest,
                _compact(self.manifest),
            ),
        }

        def fake_json(path, owner_uid, modes):
            return reads[Path(path)]

        with (
            patch.object(activator, '_read_json', side_effect=fake_json),
            patch.object(activator, '_read_root_file', return_value=b'{}'),
        ):
            with self.assertRaisesRegex(activator.Refused, 'manifest'):
                activator._validate_package(self.fake_candidate, self.current, self.preflight)
        moved = activator.render_transition_binding(self.current, candidate.ROUTES)
        moved['leaseExpiresAt'] = '2026-09-30T15:59:10.442Z'
        with (
            patch.object(activator, '_read_json', side_effect=fake_json),
            patch.object(
                activator,
                '_read_root_file',
                return_value=_compact(moved),
            ),
        ):
            with self.assertRaisesRegex(activator.Refused, 'manifest|exact route swap'):
                activator._validate_package(self.fake_candidate, self.current, self.preflight)

    def test_check_reports_ready_without_writes(self):
        with (
            patch.object(activator, '_load_candidate', return_value=self.fake_candidate),
            patch.object(activator, 'validate_current_binding', return_value=self.current['identity']),
            patch.object(activator, '_read_json', return_value=(self.current, b'{}')),
            patch.object(
                activator, '_validate_package', return_value=(self.packaged, _compact(self.packaged))
            ),
            patch.object(
                activator,
                '_service_state',
                return_value={'ActiveState': 'active', 'MainPID': '4242', 'InvocationID': 'a' * 32},
            ),
            patch.object(activator, '_firewall_preflight'),
            patch.object(activator, '_reachability_preflight'),
            patch.object(activator, '_probe_baseline', return_value=[('GET', '/x', 200, 'text/html')]),
            patch.object(
                activator,
                '_collect_inventory',
                return_value=({'observedAt': 't', 'containers': [], 'networks': []}, int(time.time() * 1000)),
            ),
            patch.object(activator, '_node_check'),
            patch.object(activator, '_gateway_account', return_value=(900, 984)),
            patch.object(activator, '_verify_socket'),
            patch.object(activator, '_install_managed') as install,
            patch.object(activator, '_restart_gateway') as restart,
        ):
            report = activator.check()
        self.assertEqual(report['status'], 'ready')
        self.assertEqual((report['routesBefore'], report['routesAfter']), (5, 11))
        self.assertEqual(report['leaseExpiresAt'], LEASE_EXPIRES_AT)
        install.assert_not_called()
        restart.assert_not_called()

    def test_activate_installs_verifies_and_receipts(self):
        calls = []
        state_dir = self.root / 'state'
        state_dir.mkdir()
        self.fake_candidate.STATE_DIRECTORY = state_dir
        self.fake_candidate.PROVENANCE_PATH = state_dir / 'funding-transition-receipt.json'
        full_preflight = dict(
            self.preflight,
            predecessorReceiptSha256='a' * 64,
            renewalReceiptSha256='b' * 64,
            postRenewalManifestSha256='c' * 64,
            packageManifestSha256='d' * 64,
            archive={'name': '7', 'bindingSha256': 'e' * 64, 'startupEvidenceSha256': 'f' * 64},
        )
        self.fake_candidate.validate_preflight = lambda: full_preflight

        def fake_install(path, content, gid):
            calls.append(('install', Path(path).name))

        with (
            patch.object(activator, '_load_candidate', return_value=self.fake_candidate),
            patch.object(activator, 'validate_current_binding', return_value=self.current['identity']),
            patch.object(
                activator, '_read_json', return_value=(self.current, _compact(self.current))
            ),
            patch.object(
                activator, '_validate_package', return_value=(self.packaged, _compact(self.packaged))
            ),
            patch.object(
                activator,
                '_service_state',
                return_value={'ActiveState': 'active', 'MainPID': '4242', 'InvocationID': 'a' * 32},
            ),
            patch.object(activator, '_firewall_preflight'),
            patch.object(activator, '_reachability_preflight'),
            patch.object(activator, '_probe_baseline', return_value=[('GET', '/x', 200, 'text/html')]),
            patch.object(
                activator,
                '_collect_inventory',
                return_value=({'observedAt': 't', 'containers': [], 'networks': []}, int(time.time() * 1000)),
            ),
            patch.object(activator, '_node_check'),
            patch.object(activator, '_gateway_account', return_value=(900, 984)),
            patch.object(activator, '_verify_socket'),
            patch.object(activator, '_safe_ancestors'),
            patch.object(activator, '_install_managed', side_effect=fake_install),
            patch.object(activator, '_restart_gateway', side_effect=lambda: calls.append(('restart',))),
            patch.object(activator, '_poll_gateway', side_effect=lambda *a: calls.append(('poll',))),
            patch.object(activator, '_verify_post_transition', side_effect=lambda b: calls.append(('verify',))),
            patch.object(tempfile, 'mkdtemp', return_value=str(self.root / 'work')),
        ):
            (self.root / 'work').mkdir(exist_ok=True)
            report = activator.activate()
        self.assertEqual(report['status'], 'activated')
        self.assertEqual(report['routesAfter'], 11)
        self.assertEqual(
            [name for name, *_ in calls],
            ['install', 'install', 'restart', 'poll', 'verify'],
        )
        receipt = json.loads((state_dir / 'funding-transition-receipt.json').read_bytes())
        self.assertEqual(receipt['activation']['routesBefore'], 5)
        self.assertEqual(receipt['activation']['routesAfter'], 11)
        self.assertIn('previousBindingSha256', receipt['activation'])

    def test_activate_rolls_back_on_failed_verification(self):
        self.fake_candidate.validate_preflight = lambda: self.preflight
        installs = []

        def fake_install(path, content, gid):
            installs.append(content)

        with (
            patch.object(activator, '_load_candidate', return_value=self.fake_candidate),
            patch.object(activator, 'validate_current_binding', return_value=self.current['identity']),
            patch.object(
                activator, '_read_json', return_value=(self.current, _compact(self.current))
            ),
            patch.object(
                activator, '_validate_package', return_value=(self.packaged, _compact(self.packaged))
            ),
            patch.object(
                activator,
                '_service_state',
                return_value={'ActiveState': 'active', 'MainPID': '4242', 'InvocationID': 'a' * 32},
            ),
            patch.object(activator, '_firewall_preflight'),
            patch.object(activator, '_reachability_preflight'),
            patch.object(activator, '_probe_baseline', return_value=[('GET', '/x', 200, 'text/html')]),
            patch.object(
                activator,
                '_collect_inventory',
                return_value=({'observedAt': 't', 'containers': [], 'networks': []}, int(time.time() * 1000)),
            ),
            patch.object(activator, '_node_check'),
            patch.object(activator, '_gateway_account', return_value=(900, 984)),
            patch.object(activator, '_verify_socket'),
            patch.object(activator, '_safe_ancestors'),
            patch.object(activator, '_install_managed', side_effect=fake_install),
            patch.object(activator, '_restart_gateway'),
            patch.object(activator, '_poll_gateway'),
            patch.object(
                activator, '_verify_post_transition', side_effect=activator.Refused('boom')
            ),
            patch.object(tempfile, 'mkdtemp', return_value=str(self.root / 'work')),
        ):
            (self.root / 'work').mkdir(exist_ok=True)
            with self.assertRaisesRegex(activator.RolledBack, 'previous binding restored'):
                activator.activate()
        self.assertEqual(len(installs), 4)

    def test_verify_post_transition_enforces_baseline_and_json(self):
        baseline = [('GET', '/x', 200, 'text/html; charset=utf-8')]
        with (
            patch.object(activator, '_probe_baseline', return_value=list(baseline)),
            patch.object(activator, 'socket_probe', return_value=(401, 'application/json')),
        ):
            activator._verify_post_transition(baseline)
        with (
            patch.object(activator, '_probe_baseline', return_value=[('GET', '/x', 500, 'text/html')]),
            patch.object(activator, 'socket_probe', return_value=(401, 'application/json')),
        ):
            with self.assertRaisesRegex(activator.Refused, 'passthrough'):
                activator._verify_post_transition(baseline)
        with (
            patch.object(activator, '_probe_baseline', return_value=list(baseline)),
            patch.object(activator, 'socket_probe', return_value=(403, 'text/html')),
        ):
            with self.assertRaisesRegex(activator.Refused, 'not served'):
                activator._verify_post_transition(baseline)


class ActivatorIoTest(unittest.TestCase):
    def test_install_managed_refuses_unsafe_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'binding.json'
            target.write_bytes(b'{}')
            target.chmod(0o644)
            with patch.object(activator, '_safe_ancestors'):
                with self.assertRaisesRegex(activator.Refused, 'unsafe'):
                    activator._install_managed(target, b'{"a":1}', os.getgid())

    def test_install_managed_replaces_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'binding.json'
            target.write_bytes(b'{}')
            target.chmod(0o440)
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self.name == 'binding.json':
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=os.getgid(), st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(activator.os, 'chown'),
                patch.object(activator, '_safe_ancestors'),
            ):
                activator._install_managed(target, b'{"a":1}', os.getgid())
            self.assertEqual(target.read_bytes(), b'{"a":1}')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o440)
            leftovers = [p for p in Path(tmp).iterdir() if p.name != 'binding.json']
            self.assertEqual(leftovers, [])

    def test_service_state_parsing(self):
        body = (
            'LoadState=loaded\nActiveState=active\nMainPID=4242\nInvocationID='
            + 'a' * 32
            + '\nRestart=no\nFragmentPath=/etc/systemd/system/x.service\nDropInPaths=\nNeedDaemonReload=no\n'
        )
        with patch.object(activator, '_run', return_value=body):
            state = activator._service_state('x.service')
        self.assertEqual(state['ActiveState'], 'active')
        with patch.object(activator, '_run', return_value=body.replace('Restart=no', 'Restart=on-failure')):
            with self.assertRaisesRegex(activator.Refused, 'Systemd state rejected'):
                activator._service_state('x.service')

    def test_cli_requires_root_and_single_mode(self):
        with patch.object(activator.os, 'geteuid', return_value=501):
            self.assertEqual(activator.main(['--check']), 1)
        with (
            patch.object(activator.os, 'geteuid', return_value=0),
            patch.object(activator, 'verify_graph'),
            patch.object(activator, 'check', return_value={'status': 'ready'}),
            patch.object(activator, '_locked', return_value=contextlib.nullcontext()),
        ):
            self.assertEqual(activator.main(['--check']), 0)
        with self.assertRaises(SystemExit):
            activator.main(['--check', '/tmp'])


class ActivatorFragmentPinTest(unittest.TestCase):
    def test_pinned_fragments_verify(self):
        self.assertEqual(len(activator.ACTIVATOR_FRAGMENT_SHA256), 4)
        for name in activator.ACTIVATOR_FRAGMENT_SHA256:
            content, filename = activator._fragment_bytes(name)
            self.assertTrue(content)
            self.assertTrue(filename.endswith(name))

    def test_unpinned_fragment_name_is_refused(self):
        with self.assertRaisesRegex(activator.Refused, 'not pinned'):
            activator._fragment_bytes(
                'funding-gateway-transition-activator-evil.py'
            )

    def test_tampered_fragment_bytes_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            tampered = Path(tmp) / 'fragment.py'
            tampered.write_bytes(b'tampered')
            with self.assertRaisesRegex(activator.Refused, 'failed verification'):
                activator._fragment_bytes(
                    'funding-gateway-transition-activator-shared.py', tampered
                )


if __name__ == '__main__':
    unittest.main()
