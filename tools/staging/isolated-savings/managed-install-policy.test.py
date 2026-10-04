import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

BASE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


POLICY = load('managed-install-policy')
TRANSACTION = load('managed-install-transaction')
INSTALLER = load('install-managed-gateway')


def bundle():
    payloads = {name: (BASE / name).read_bytes() for name in POLICY.FILES}
    manifest = {'version': 1, 'files': {name: hashlib.sha256(content).hexdigest() for name, content in payloads.items()},
                'versions': {name: 'synthetic-reviewed-version' for name in POLICY.VERSIONS}}
    return manifest, payloads


class PolicyTests(unittest.TestCase):
    def test_command_failure_retains_exit_only_not_args_or_output(self):
        with patch.object(POLICY.subprocess, 'run', return_value=types.SimpleNamespace(returncode=17, stdout=b'secret')):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                POLICY.run(['secret-argument'])
        self.assertEqual(caught.exception.returncode, 17)
        self.assertEqual(caught.exception.cmd, ())
        self.assertIsNone(caught.exception.output)

    def test_checked_in_manifest_matches_candidate_bytes_and_complete_version_inventory(self):
        manifest = json.loads((BASE / 'managed-install-manifest.json').read_text())
        expected, payloads = bundle()
        self.assertEqual(manifest['files'], expected['files'])
        POLICY.validate_bundle(manifest, payloads)

    def test_exact_manifest_and_transitive_import_closure(self):
        manifest, payloads = bundle()
        POLICY.validate_bundle(manifest, payloads)
        for name in POLICY.FILES:
            with self.subTest(missing=name), self.assertRaises(RuntimeError):
                POLICY.validate_bundle(manifest, {key: value for key, value in payloads.items() if key != name})
        for altered in ({**payloads, 'managed-gateway.mjs': b'changed'}, {**payloads, 'unexpected': b'code'}):
            with self.assertRaises(RuntimeError):
                POLICY.validate_bundle(manifest, altered)
        payloads['managed-gateway.mjs'] += b"\nimport extra from './unreviewed.mjs';\n"
        manifest['files']['managed-gateway.mjs'] = hashlib.sha256(payloads['managed-gateway.mjs']).hexdigest()
        with self.assertRaisesRegex(RuntimeError, 'Unbundled'):
            POLICY.validate_bundle(manifest, payloads)

    def test_unreviewed_binary_inventory_rejected(self):
        manifest, payloads = bundle()
        manifest['versions']['/usr/bin/docker'] = 'REVIEW_REQUIRED'
        with self.assertRaisesRegex(RuntimeError, 'Reviewed binary'):
            POLICY.validate_bundle(manifest, payloads)
        manifest['versions'].pop('/usr/bin/docker')
        with self.assertRaisesRegex(RuntimeError, 'inventory incomplete'):
            POLICY.validate_bundle(manifest, payloads)

    def test_root_readonly_regular_single_link_metadata(self):
        info = {'st_mode': stat.S_IFREG | 0o440, 'st_uid': 0, 'st_nlink': 1}
        POLICY.metadata(types.SimpleNamespace(**info), readonly=True)
        for changes in ({'st_uid': 1000}, {'st_mode': stat.S_IFREG | 0o640},
                        {'st_mode': stat.S_IFLNK | 0o777}, {'st_nlink': 2},
                        {'st_mode': stat.S_IFREG | 0o4440}):
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                POLICY.metadata(types.SimpleNamespace(**{**info, **changes}), readonly=True)

    def test_binary_version_mismatch_is_fatal(self):
        versions = {name: 'reviewed' for name in POLICY.VERSIONS}
        with patch.object(POLICY, 'binary'), patch.object(POLICY, 'run', return_value='different'):
            with self.assertRaisesRegex(RuntimeError, 'version mismatch'):
                POLICY.validate_binaries(versions)

    def test_binary_resolves_only_root_owned_links_and_rejects_capabilities(self):
        link = types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)
        regular = types.SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0)
        with patch.object(POLICY, 'parents'), patch.object(POLICY.os, 'lstat', side_effect=[link, regular]), \
                patch.object(POLICY.os, 'readlink', return_value='python3.12'), patch.object(POLICY.os, 'listxattr', return_value=[], create=True):
            self.assertEqual(POLICY.binary('/usr/bin/python3'), '/usr/bin/python3.12')
        for info, attributes in ((types.SimpleNamespace(st_mode=link.st_mode, st_uid=1000), []),
                                 (types.SimpleNamespace(st_mode=stat.S_IFREG | 0o777, st_uid=0), []),
                                 (regular, ['security.capability'])):
            with patch.object(POLICY, 'parents'), patch.object(POLICY.os, 'lstat', return_value=info), \
                    patch.object(POLICY.os, 'listxattr', return_value=attributes, create=True), self.assertRaises(RuntimeError):
                POLICY.binary('/usr/bin/python3')

    def test_only_root_owned_sudo_and_passwd_may_be_setuid_never_setgid(self):
        for path in ('/usr/bin/sudo', '/usr/bin/passwd', '/usr/bin/node'):
            for mode in (0o755, 0o4755, 0o2755, 0o6755):
                for uid in (0, 1000):
                    info = types.SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=uid)
                    allowed = uid == 0 and (mode == 0o755 or
                              mode == 0o4755 and path in ('/usr/bin/sudo', '/usr/bin/passwd'))
                    with self.subTest(path=path, mode=oct(mode), uid=uid), \
                            patch.object(POLICY, 'parents'), \
                            patch.object(POLICY.os, 'lstat', return_value=info), \
                            patch.object(POLICY.os, 'listxattr', return_value=[], create=True):
                        if allowed:
                            self.assertEqual(POLICY.binary(path), path)
                        else:
                            with self.assertRaises(RuntimeError):
                                POLICY.binary(path)

    def test_active_enabled_dropins_and_runtime_collisions_are_refused(self):
        baseline = {'LoadState': 'loaded', 'ActiveState': 'inactive', 'UnitFileState': 'static', 'DropInPaths': ''}
        for change in ({'ActiveState': 'active'}, {'UnitFileState': 'enabled'}, {'DropInPaths': '/unreviewed'}):
            output = '\n'.join(key + '=' + value for key, value in {**baseline, **change}.items())
            with patch.object(POLICY, 'run', return_value=output), self.assertRaises(RuntimeError):
                POLICY.inactive()

    def test_collision_preflight_never_runs_creation(self):
        manifest, payloads = bundle()
        calls = []
        with patch.object(POLICY, 'validate_binaries'), patch.object(POLICY, 'parents'), \
                patch.object(POLICY.os.path, 'lexists', return_value=True), \
                patch.object(POLICY, 'run', side_effect=lambda args: calls.append(args)):
            with self.assertRaisesRegex(RuntimeError, 'collision'):
                POLICY.preflight(manifest, payloads, None, None)
        self.assertEqual(calls, [])

if __name__ == '__main__':
    unittest.main()
