import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import installation_contract as contract
from replay_cutover_runtime import expected_container
from runtime_scheduler import container_contract
from treasury_owner_contract import Refused as RuntimeRefused


class InstallationContractTests(unittest.TestCase):
    def containers(self):
        containers = {kind: container_contract(kind, contract.WORKER_LABEL) for kind in contract.KINDS}
        containers['replay'] = expected_container(str(contract.REPLAY_ROOT), contract.REPLAY_LABEL, False)
        containers['replay-check'] = expected_container(str(contract.REPLAY_ROOT), contract.REPLAY_LABEL, True)
        for row in containers.values():
            row['Config']['Env'] = ['NODE_VERSION=pinned']
            row['State'] = {'Running': False}
        return containers

    def test_original_isolated_stopped_predecessors_are_accepted(self):
        contract.validate_predecessor(self.containers(), ['NODE_VERSION=pinned'])

    def test_parser_repaired_predecessor_requires_its_retained_reviewed_manifest_label(self):
        self.assertEqual(contract.REPLAY_LABEL,
            '1445e1b2a7f9e7e28801c8bd036b833fdbe8ec02facb5bc4d5e00c0c71e7de42')
        for kind in ('replay', 'replay-check'):
            rows = self.containers()
            rows[kind]['Config']['Labels']['com.baci.prefunded-replay.sha256'] = (
                'cf11c95d0724bcc45ac2dd4b0b689322c432ce40c2068d4e18a3a9fbbf734106')
            with self.subTest(kind=kind), self.assertRaises(RuntimeRefused):
                contract.validate_predecessor(rows, ['NODE_VERSION=pinned'])

    def test_rejects_running_old_code_before_any_replacement(self):
        rows = self.containers()
        rows['snapshot']['State']['Running'] = True
        with self.assertRaisesRegex(ValueError, 'installation_predecessor_active'):
            contract.validate_predecessor(rows, ['NODE_VERSION=pinned'])

    def test_environment_flags_extra_network_or_changed_label_are_not_inherited(self):
        for kind, change in (
            ('background', lambda row: row['Config']['Env'].append('MUTATIONS_ENABLED=true')),
            ('snapshot', lambda row: row['NetworkSettings']['Networks'].update({'foreign': {}})),
            ('replay', lambda row: row['Config']['Labels'].update({'com.baci.prefunded-replay.sha256': 'a'*64})),
        ):
            rows = self.containers()
            change(rows[kind])
            with self.subTest(kind=kind), self.assertRaises((ValueError, RuntimeRefused)):
                contract.validate_predecessor(rows, ['NODE_VERSION=pinned'])

    def test_unknown_predecessor_file_set_refuses_before_tree_read(self):
        with patch.object(contract, 'tree_fingerprint') as reader:
            with self.assertRaisesRegex(ValueError, 'tree_set_refused'):
                contract.validate_tree(contract.WORKER_ROOT, {'code/unknown.js': {}})
            reader.assert_not_called()

    def test_seal_drift_or_production_scope_refuses(self):
        for field, value in (('approvedCompanyBudgetKobo', 10001), ('mutationsEnabled', True),
                             ('deadline', '2026-10-07T15:59:10Z')):
            seal = {'status': 'source-verified-prepared-inactive', 'deadline': contract.DEADLINE,
                'approvedCompanyBudgetKobo': 10000, 'preservedPrincipalKobo': 10000,
                'mutationsEnabled': False, 'files': {'replay/daemon.mjs': 'b'*64}}
            seal[field] = value
            with patch.object(contract, 'pin_read', return_value=json.dumps(seal).encode()):
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'seal_scope_refused'):
                    contract.verify_seal(Path('/private'), 'a'*64)

    def test_seal_cannot_escape_private_bundle(self):
        seal = {'status': 'source-verified-prepared-inactive', 'deadline': contract.DEADLINE,
            'approvedCompanyBudgetKobo': 10000, 'preservedPrincipalKobo': 10000,
            'mutationsEnabled': False, 'files': {'../foreign': 'b'*64}}
        with patch.object(contract, 'pin_read', return_value=json.dumps(seal).encode()):
            with self.assertRaisesRegex(ValueError, 'seal_path_refused'):
                contract.verify_seal(Path('/private'), 'a'*64)

    def test_missing_snapshot_credential_is_not_replaced_by_operator_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = {'status': 'expiry_rebuild_prepared', 'deadline': contract.DEADLINE,
                'changesApplied': False, 'artifacts': {'artifacts': [{
                    'sourcePath': '/opt/baci-prefunded-workers/config/background.json',
                    'candidatePath': 'workers/background.json', 'candidateSha256': 'b'*64}]}}
            content = json.dumps(metadata).encode()
            (root/'candidate.json').write_bytes(content)
            with patch.object(contract, 'pin_read', side_effect=lambda path, expected: content
                    if path.name == 'candidate.json' else b'{}'):
                with self.assertRaisesRegex(ValueError, 'private_configs_missing'):
                    contract.candidate_inputs(root, {}, root, root, {}, contract.digest(content))

    def test_candidate_metadata_drift_refuses_before_loading_private_configs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = b'{"status":"expiry_rebuild_prepared"}'
            (root / 'candidate.json').write_bytes(b'{"status":"tampered"}')
            with self.assertRaisesRegex(ValueError, 'activation_input_pin_mismatch'):
                contract.candidate_inputs(root, {}, root, root, {}, contract.digest(original))


if __name__ == '__main__':
    unittest.main()
