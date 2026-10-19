import ast
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import worker_source_authority as module


HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'prefunded-card'
SPEC = importlib.util.spec_from_file_location('worker_scheduler_fixture', SOURCE / 'runtime_scheduler.py')
SCHEDULER = importlib.util.module_from_spec(SPEC)
import sys
sys.path.insert(0, str(SOURCE))
SPEC.loader.exec_module(SCHEDULER)
CONTAINER = '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4'
OUTPUTS = dict(
    background='f738f98b7cd847fed8da38841e0bfa4e4c66d95bd0e938e51ac6ef607d55ce83',
    readiness='16a051e6cb50c867dac420bc578a27ac44216d67039122b66ac80aba571a1d33',
    snapshot='fd25dbfa07d191495d9bb2efab4aa0fb39d7febd056f185f2c1b9e14a4ac72bf')
ORIGINAL_PIN = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
OLD_DEADLINE = '2026-09-29T15:59:10Z'
EXPIRIES = ('expected.expiresAt', 'publicCheckout.checkout.provider.expiresAt',
    'publicCheckout.checkout.scope.expiresAt', 'publicCheckout.expiresAt', 'recovery.provider.expiresAt',
    'recovery.scope.expiresAt', 'savedCardPublicRuntime.expiresAt')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


class WorkerSourceAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.scheduler = (SOURCE / 'runtime_scheduler.py').read_bytes()
        self.wrapper = (SOURCE / 'background-runner.sh').read_bytes()
        outputs = {name + '.cjs': pin for name, pin in OUTPUTS.items()}
        self.manifest = dict(version=1, status='source-verified-prepared-inactive', deadline=module.DEADLINE,
            approvedCompanyBudgetKobo=10000, preservedPrincipalKobo=10000, retiredIntentId=module.RETIRED,
            mutationsEnabled=False, changesApplied=False, financialStarted=False, newPaymentStarted=False,
            workers=dict(outputs=outputs, sourceVerified=True), files={
                **{'workers/' + name: pin for name, pin in outputs.items()},
                'tooling/runtime_scheduler.py': module.SCHEDULER_SHA256,
                'tooling/background-runner.sh': hashlib.sha256(self.wrapper).hexdigest()})
        self.candidate = dict(status='expiry_rebuild_prepared', deadline=module.DEADLINE,
            changesApplied=False, servicesRestarted=False, newPaymentStarted=False,
            artifacts=dict(deadline=module.DEADLINE, changesApplied=False, artifacts=[dict(
                sourcePath=module.CONFIGURATION, sourceSha256=ORIGINAL_PIN,
                candidatePath='workers/background.json', candidateSha256=module.CONFIGURATION_SHA256)]))
        self.configuration = dict(expected=dict(systemIdentifier=module.SYSTEM, database='postgres',
                expiresAt=module.DEADLINE), background=dict(worker=dict(module.SCOPE)),
            recovery=dict(provider=dict(expiresAt=module.DEADLINE), scope=dict(deployment='staging', integrationId=module.SCOPE['integrationId'],
                merchantId=module.SCOPE['merchantId'], treasuryBindingId=module.SCOPE['treasuryBindingId'],
                businessId=module.SCOPE['businessId'], systemIdentifier=module.SYSTEM, expiresAt=module.DEADLINE)),
            publicCheckout=dict(maximumAmountKobo=10000, expiresAt=module.DEADLINE, checkout=dict(
                provider=dict(expiresAt=module.DEADLINE), scope=dict(expiresAt=module.DEADLINE))),
            savedCardPublicRuntime=dict(expiresAt=module.DEADLINE), private='synthetic-private-marker', privateCount=1)
        self.original = copy.deepcopy(self.configuration)
        for path in EXPIRIES:
            record = self.original
            for name in path.split('.')[:-1]:
                record = record[name]
            record['expiresAt'] = OLD_DEADLINE
        self.proof_pin = hashlib.sha256(encoded(self.candidate)).hexdigest()
        self.clock = datetime(2026, 10, 3, 8, 0, tzinfo=timezone.utc)
        container = SCHEDULER.container_contract('background', module.MANIFEST_SHA256)
        container.update(Id=CONTAINER, Name='/baci-prefunded-background', State=dict(
            Running=False, Paused=False, Restarting=False, Dead=False, Status='exited'))
        container['Config']['Env'] = ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=22']
        files = {module.ROOT + '/code/' + name: dict(sha256=pin, uid=0, gid=0, mode=0o444,
                    nlink=1, regularFile=True) for name, pin in outputs.items()}
        files[module.ROOT + '/code/background.sh'] = dict(sha256=hashlib.sha256(
            SCHEDULER.background_wrapper().encode()).hexdigest(), uid=0, gid=0, mode=0o444, nlink=1, regularFile=True)
        files[module.CONFIGURATION] = dict(sha256=module.CONFIGURATION_SHA256, uid=65532,
            gid=65532, mode=0o600, nlink=1, regularFile=True)
        files[module.UNIT] = dict(sha256=hashlib.sha256(SCHEDULER.units()['background.service'].encode()).hexdigest(),
            uid=0, gid=0, mode=0o644, nlink=1, regularFile=True)
        self.facts = dict(observedAt='2026-10-03T08:00:00Z', files=files, container=container,
            image=dict(Id=SCHEDULER.IMAGE, Config=dict(Env=list(container['Config']['Env']))),
            unit=dict(FragmentPath=module.UNIT, DropInPaths='', NeedDaemonReload='no',
                      LoadState='loaded', ActiveState='inactive', SubState='dead'))

    def inputs(self):
        return dict(manifest_bytes=encoded(self.manifest), candidate_bytes=encoded(self.candidate),
            original_configuration_bytes=encoded(self.original),
            configuration_bytes=encoded(self.configuration), scheduler_bytes=self.scheduler,
            wrapper_bytes=self.wrapper, facts=self.facts)

    def validate(self, **changes):
        values = self.inputs() | changes
        real = module._sha
        pinned = {encoded(self.manifest): module.MANIFEST_SHA256,
                  encoded(self.original): ORIGINAL_PIN,
                  encoded(self.configuration): module.CONFIGURATION_SHA256}
        with (patch.object(module, 'CANDIDATE_SHA256', self.proof_pin),
              patch.object(module, '_sha', side_effect=lambda value: pinned.get(value, real(value))),
              patch.object(module, 'datetime') as clock):
            clock.now.return_value = self.clock
            clock.fromisoformat.side_effect = datetime.fromisoformat
            return module.validate_worker_source_authority(**values)

    def test_missing_original_pins_refuse_even_if_all_observed_self_hashes_match(self):
        with patch.object(module, 'BACKGROUND_CONTAINER_ID', None), self.assertRaisesRegex(ValueError, '^worker_original_authority_missing$'):
            module.validate_worker_source_authority(**self.inputs())

    def test_synthetic_pin_mocks_bind_source_outputs_candidate_and_profile_without_claiming_live_authority(self):
        self.assertEqual(module.BACKGROUND_CONTAINER_ID, CONTAINER)
        before = copy.deepcopy(self.inputs())
        result = self.validate()
        self.assertEqual(result['status'], 'worker-source-inputs-bound')
        self.assertEqual(result['containerId'], CONTAINER)
        self.assertEqual(result['fileHashes'][module.ROOT + '/code/background.cjs'], OUTPUTS['background'])
        self.assertEqual(result['configurationSha256'], module.CONFIGURATION_SHA256)
        self.assertEqual(result['candidateSha256'], self.proof_pin)
        self.assertEqual(result['approvedCompanyBudgetKobo'], 10000)
        self.assertEqual(result['approvedPreservedPrincipalKobo'], 10000)
        self.assertNotIn('synthetic-private-marker', json.dumps(result))
        self.assertNotIn('activationAuthorized', result)
        self.assertEqual(self.inputs(), before)

    def test_unmodified_hash_function_rejects_synthetic_manifest_before_authority(self):
        with (patch.object(module, 'CANDIDATE_SHA256', self.proof_pin),
              self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$')):
            module.validate_worker_source_authority(**self.inputs())

    def test_wrong_original_candidate_bytes_refuse_even_with_correct_installed_config(self):
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate(candidate_bytes=encoded(self.candidate) + b' ')

    def test_observed_compiled_hash_cannot_replace_sealed_source_output(self):
        self.facts['files'][module.ROOT + '/code/background.cjs']['sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_original_configuration_bytes_are_required_not_only_installed_digest(self):
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate(configuration_bytes=b'{}')

    def test_original_authority_bytes_and_candidate_source_link_are_required(self):
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate(original_configuration_bytes=b'{}')
        self.candidate['artifacts']['artifacts'][0]['sourceSha256'] = 'f' * 64
        self.proof_pin = hashlib.sha256(encoded(self.candidate)).hexdigest()
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_exactly_seven_expiry_changes_preserve_every_other_key_value_and_type(self):
        baseline = copy.deepcopy(self.configuration)
        for path in (*EXPIRIES, 'private', 'newKey', 'privateCount', 'publicCheckout.maximumAmountKobo'):
            self.configuration = copy.deepcopy(baseline)
            record = self.configuration
            for name in path.split('.')[:-1]:
                record = record[name]
            record[path.split('.')[-1]] = OLD_DEADLINE if path in EXPIRIES else True
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()
        self.configuration = baseline
        del self.configuration['private']
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_candidate_link_missing_duplicate_foreign_path_or_wrong_hash_refuses(self):
        original = copy.deepcopy(self.candidate)
        for change in ('missing', 'duplicate', 'foreign', 'wrong', 'traversal'):
            self.candidate = copy.deepcopy(original)
            rows = self.candidate['artifacts']['artifacts']
            if change == 'missing':
                rows.clear()
            elif change == 'duplicate':
                rows.append(copy.deepcopy(rows[0]))
            elif change == 'foreign':
                rows[0]['sourcePath'] = '/foreign/background.json'
            elif change == 'wrong':
                rows[0]['candidateSha256'] = 'f' * 64
            else:
                rows[0]['candidatePath'] = '../background.json'
            self.proof_pin = hashlib.sha256(encoded(self.candidate)).hexdigest()
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()

    def test_manifest_scope_flags_caps_and_source_pin_consistency_refuse(self):
        baseline = copy.deepcopy(self.manifest)
        for name, value in (('deadline','2026-10-07T15:59:10Z'), ('approvedCompanyBudgetKobo',20000),
            ('preservedPrincipalKobo',0), ('mutationsEnabled',True), ('version',True)):
            self.manifest = copy.deepcopy(baseline)
            self.manifest[name] = value
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()
        self.manifest = baseline
        self.manifest['files']['workers/background.cjs'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_source_scheduler_or_wrapper_bytes_cannot_be_replaced_by_installed_metadata(self):
        for name in ('scheduler_bytes', 'wrapper_bytes'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate(**{name:b'foreign'})

    def test_source_unit_and_wrapper_rendering_match_pinned_scheduler_without_production_import(self):
        self.assertEqual(hashlib.sha256(self.scheduler).hexdigest(), module.SCHEDULER_SHA256)
        self.assertEqual(module.BACKGROUND_UNIT, SCHEDULER.units()['background.service'].encode())
        self.assertEqual(module._wrapper(self.wrapper), SCHEDULER.background_wrapper().encode())

    def test_config_scope_database_deadline_and_amount_cap_refuse(self):
        baseline = copy.deepcopy(self.configuration)
        for path, value in ((('expected','systemIdentifier'),'foreign'), (('expected','database'),'foreign'),
            (('expected','expiresAt'),'2026-10-07T15:59:10Z'), (('background','worker','businessId'),'foreign'),
            (('recovery','scope','merchantId'),'foreign'), (('publicCheckout','maximumAmountKobo'),20000)):
            self.configuration = copy.deepcopy(baseline)
            record = self.configuration
            for name in path[:-1]:
                record = record[name]
            record[path[-1]] = value
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()

    def test_config_code_and_unit_metadata_refuse_foreign_owner_mode_hardlink_or_nonregular(self):
        for path in (module.CONFIGURATION, module.ROOT + '/code/background.cjs', module.UNIT):
            original = dict(self.facts['files'][path])
            for name, value in (('uid',1), ('gid',1), ('mode',0o666), ('nlink',2), ('regularFile',False), ('uid',False)):
                self.facts['files'][path] = original | {name:value}
                with self.subTest(path=path,name=name), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                    self.validate()
            self.facts['files'][path] = original

    def test_wrong_sibling_truncated_ids_role_label_image_environment_or_running_state_refuses(self):
        baseline = copy.deepcopy(self.facts)
        cases = [(('container','Id'),'a' * 64), (('container','Id'),CONTAINER[:-1] + '5'),
            (('container','Id'),CONTAINER[:12]), (('container','Config','User'),'0:0'),
            (('container','Config','Labels',SCHEDULER.LABEL),'b' * 64), (('container','State','Running'),True),
            (('container','Config','Env'),['EXTRA=1']), (('image','Id'),'sha256:' + 'a' * 64)]
        for path, value in cases:
            self.facts = copy.deepcopy(baseline)
            record = self.facts
            for name in path[:-1]:
                record = record[name]
            record[path[-1]] = value
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()

    def test_container_mount_security_network_and_duplicate_base_env_refuse(self):
        baseline = copy.deepcopy(self.facts)
        for kind in ('rw', 'extra_mount', 'privileged', 'network', 'duplicate_env'):
            self.facts = copy.deepcopy(baseline)
            container = self.facts['container']
            if kind == 'rw':
                container['Mounts'][0]['RW'] = True
            elif kind == 'extra_mount':
                container['Mounts'].append(dict(Type='bind',Source='/',Destination='/host',RW=True))
            elif kind == 'privileged':
                container['HostConfig']['Privileged'] = True
            elif kind == 'network':
                container['NetworkSettings']['Networks']['host'] = {}
            else:
                self.facts['image']['Config']['Env'].append('PATH=extra')
                container['Config']['Env'] = self.facts['image']['Config']['Env']
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()

    def test_effective_unit_dropins_reload_active_and_unsealed_file_set_refuse(self):
        for name, value in (('DropInPaths','/foreign.conf'), ('NeedDaemonReload','yes'),
            ('ActiveState','active'), ('FragmentPath','/foreign.service')):
            original = self.facts['unit'][name]
            self.facts['unit'][name] = value
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()
            self.facts['unit'][name] = original
        self.facts['files']['/foreign'] = dict(self.facts['files'][module.UNIT])
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_stale_future_and_deadline_facts_refuse_without_public_clock_override(self):
        for observed in ('2026-10-03T07:58:59Z','2026-10-03T08:00:01Z','2026-10-06T15:59:10Z'):
            self.facts['observedAt'] = observed
            with self.subTest(observed=observed), self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
                self.validate()
        self.facts['observedAt'] = '2026-10-06T15:59:10Z'
        self.clock = datetime(2026,10,6,15,59,10,tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, '^worker_source_authority_refused$'):
            self.validate()

    def test_pure_module_has_no_execution_filesystem_network_or_callback_authority(self):
        source = (HERE / 'worker_source_authority.py').read_text()
        tree = ast.parse(source)
        self.assertLess(len(source.splitlines()), 300)
        imports = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        imports |= {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        self.assertLessEqual(imports, {'datetime','hashlib','json','re'})
        calls = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func,ast.Name)}
        self.assertFalse(calls & {'open','exec','eval','compile','getattr','__import__'})
        self.assertFalse(any(isinstance(node,ast.Assert) for node in ast.walk(tree)))
        with self.assertRaises(TypeError):
            module.validate_worker_source_authority(**self.inputs(), candidate_sha256=self.proof_pin)
if __name__ == '__main__':
    unittest.main()
