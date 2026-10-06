import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import mutation_owner
import mutation_gate
import mutation_runtime_bounds as bounds


class BoundsTests(unittest.TestCase):
    def source_fixture(self, directory):
        root = Path(directory).resolve()
        modules = dict(sys.modules)
        files = {}
        for name, module in list(modules.items()):
            path = Path(getattr(module, '__file__', '') or '.')
            if '/tools/staging/' not in str(path):
                continue
            if name in bounds.RuntimeBounds.SIDECARS:
                relative = 'sidecar/' + path.name
            elif path.parent.name == 'financial-activation':
                relative = 'tooling/financial-activation/' + path.name
            elif path.parent.name == 'card-week-renewal':
                relative = 'tooling/card-week-renewal/' + path.name
            else:
                relative = 'tooling/' + path.name
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            content = path.read_bytes()
            target.write_bytes(content)
            modules[name] = SimpleNamespace(__file__=str(target))
            if not relative.startswith('sidecar/'):
                files[relative] = hashlib.sha256(content).hexdigest()
        wrapper = root / 'tooling/background-runner.sh'
        wrapper.write_bytes(Path(bounds.runtime_scheduler.__file__).with_name('background-runner.sh').read_bytes())
        files['tooling/background-runner.sh'] = hashlib.sha256(wrapper.read_bytes()).hexdigest()
        seal = {'files': files}
        raw = json.dumps(seal).encode()
        (root / 'financial-preparation.json').write_bytes(raw)
        seal_sha = hashlib.sha256(raw).hexdigest()
        return bounds.RuntimeBounds(root, seal, seal_sha), modules, seal_sha

    def test_actual_loaded_dependency_paths_and_bytes_match_seal_closure(self):
        with tempfile.TemporaryDirectory() as directory:
            value, modules, seal_sha = self.source_fixture(directory)
            with patch.object(bounds, 'FINANCIAL_SEAL', seal_sha), \
                    patch.object(bounds.runtime_scheduler, '__file__', modules['runtime_scheduler'].__file__), \
                    patch.object(bounds, '__file__', modules['mutation_runtime_bounds'].__file__), \
                    patch.object(bounds.sys, 'modules', modules):
                result = value.verify_sources()
            self.assertEqual(result['runtime_scheduler']['path'],
                             str(value.bundle / 'tooling/runtime_scheduler.py'))
            self.assertIn('phone_authentication', result)

    def test_identical_dependency_bytes_loaded_from_other_root_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            value, modules, seal_sha = self.source_fixture(directory)
            original = Path(modules['runtime_scheduler'].__file__)
            copied = value.bundle / 'unsealed-runtime_scheduler.py'
            copied.write_bytes(original.read_bytes())
            modules['runtime_scheduler'] = SimpleNamespace(__file__=str(copied))
            with patch.object(bounds, 'FINANCIAL_SEAL', seal_sha), \
                    patch.object(bounds.runtime_scheduler, '__file__', modules['runtime_scheduler'].__file__), \
                    patch.object(bounds, '__file__', modules['mutation_runtime_bounds'].__file__), \
                    patch.object(bounds.sys, 'modules', modules), \
                    self.assertRaisesRegex(ValueError, 'dependency_outside_r8'):
                value.verify_sources()

    def test_same_root_dependency_drift_or_missing_module_refuse(self):
        for missing in (True, False):
            with tempfile.TemporaryDirectory() as directory:
                value, modules, seal_sha = self.source_fixture(directory)
                if missing:
                    modules.pop('runtime_scheduler')
                else:
                    Path(modules['runtime_scheduler'].__file__).write_bytes(b'changed')
                with patch.object(bounds, 'FINANCIAL_SEAL', seal_sha), \
                        patch.object(bounds, '__file__', modules['mutation_runtime_bounds'].__file__), \
                        patch.object(bounds.sys, 'modules', modules), self.assertRaises(ValueError):
                    value.verify_sources()

    def test_r7_or_changed_manifest_refuse_before_using_loaded_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            value, modules, seal_sha = self.source_fixture(directory)
            with self.assertRaisesRegex(ValueError, 'bounds_r8_required'):
                value.verify_sources()
            (value.bundle / 'financial-preparation.json').write_bytes(b'{}')
            with patch.object(bounds, 'FINANCIAL_SEAL', seal_sha), \
                    self.assertRaisesRegex(ValueError, 'source_seal_refused'):
                value.verify_sources()

    def runtime_fixture(self):
        value = bounds.RuntimeBounds(Path('/root/r8'), {}, bounds.FINANCIAL_SEAL)
        value.verify_sources = Mock(return_value={'runtime_scheduler': 'sealed'})
        containers = {}
        for kind in ('background', 'snapshot', 'readiness', 'replay', 'replay-check'):
            replay = kind.startswith('replay')
            row = (bounds.replay_cutover_runtime.expected_container('/opt/baci-prefunded-replay',
                bounds.FINANCIAL_SEAL, kind == 'replay-check') if replay else
                bounds.runtime_scheduler.container_contract(kind, bounds.FINANCIAL_SEAL))
            name = (bounds.replay_cutover_runtime.CONTAINER + ('-check' if kind == 'replay-check' else '')
                    if replay else 'baci-prefunded-' + kind)
            row['Id'] = ('a' if replay else 'b') * 64
            row['Config']['Env'] = ['PATH=/usr/local/bin:/usr/bin']
            containers[name] = row
        image = bounds.runtime_scheduler.IMAGE
        def run(arguments):
            if 'image' in arguments:
                return json.dumps([{'Id': image, 'Config': {'Env': ['PATH=/usr/local/bin:/usr/bin']}}])
            return json.dumps([containers[arguments[-1]]])
        return value, containers, run

    def test_all_five_containers_and_exact_rendered_installed_wrapper_pass(self):
        value, containers, run = self.runtime_fixture()
        expected = bounds.runtime_scheduler.background_wrapper().encode()
        with patch.object(bounds, 'root_ancestors'), patch.object(bounds, 'read_file', return_value=expected):
            self.assertEqual(set(value.verify_runtime(run)), set(containers))
        self.assertEqual(value.verify_sources.call_count, 2)

    def test_modified_wrapper_cannot_fabricate_completed_worker_report(self):
        value, containers, run = self.runtime_fixture()
        with patch.object(bounds, 'root_ancestors'), \
                patch.object(bounds, 'read_file', return_value=b'printf \'{"status":"completed"}\''), \
                self.assertRaisesRegex(ValueError, 'installed_wrapper_drift'):
            value.verify_runtime(run)

    def test_every_financial_and_check_container_rejects_injected_or_missing_environment(self):
        for name in self.runtime_fixture()[1]:
            for environment in ([], ['PATH=/usr/local/bin:/usr/bin', 'NODE_OPTIONS=--require=/tmp/injected.js'],
                    ['PATH=/usr/local/bin:/usr/bin', bounds.FLAG + '=false']):
                value, containers, run = self.runtime_fixture()
                containers[name]['Config']['Env'] = environment
                with patch.object(bounds, 'root_ancestors'), \
                        patch.object(bounds, 'read_file', return_value=bounds.runtime_scheduler.background_wrapper().encode()), \
                        self.subTest(name=name, environment=environment), \
                        self.assertRaisesRegex(ValueError, 'financial_environment_drift'):
                    value.verify_runtime(run)

    def test_image_cannot_supply_mutation_flag_even_if_container_inherits_it(self):
        value, containers, run = self.runtime_fixture()
        def altered(arguments):
            rows = json.loads(run(arguments))
            rows[0]['Config']['Env'].append(bounds.FLAG + '=false')
            return json.dumps(rows)
        with patch.object(bounds, 'root_ancestors'), \
                patch.object(bounds, 'read_file', return_value=bounds.runtime_scheduler.background_wrapper().encode()), \
                self.assertRaisesRegex(ValueError, 'image_mutation_flag_refused'):
            value.verify_runtime(altered)

    def test_changed_wrapper_between_checks_refuses(self):
        value, containers, run = self.runtime_fixture()
        with patch.object(bounds, 'root_ancestors'), patch.object(bounds, 'read_file', side_effect=[
                bounds.runtime_scheduler.background_wrapper().encode(), b'changed']), \
                self.assertRaisesRegex(ValueError, 'runtime_bounds_changed'):
            value.verify_runtime(run)

    def test_guard_refuses_check_start_before_any_underlying_command_on_bounds_failure(self):
        value, containers, run = self.runtime_fixture()
        value.verify_runtime = Mock(side_effect=ValueError('bounds failed'))
        runner = Mock()
        for name in ('baci-prefunded-readiness', bounds.replay_cutover_runtime.CONTAINER + '-check'):
            with self.assertRaisesRegex(ValueError, 'bounds failed'):
                value.guarded_run([*bounds.DOCKER, 'start', '--attach', name], run=runner)
        runner.assert_not_called()


if __name__ == '__main__':
    unittest.main()
