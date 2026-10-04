import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tarfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import continuation_evidence as SUBJECT
import continuation_legacy as LEGACY


CAPTURE = Path('/private/tmp/baci-continuation-evidence.HBRF8ogA/capture.tar')
ARCHIVE_SHA = '67eb681dc9adf86dadbcba6655449f5626bd570c1b7f0bc6470dd74033ec254a'


def fixtures():
    raw = CAPTURE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA:
        raise ValueError('private capture changed')
    with tarfile.open(CAPTURE) as archive:
        members = archive.getmembers()
        if len(members) != 48 or not all(member.isfile() for member in members):
            raise ValueError('private capture shape changed')
        contents = {member.name: archive.extractfile(member).read() for member in members}
    if len(contents) != 48:
        raise ValueError('duplicate capture member')
    original = {name.removeprefix('original/'): value for name, value in contents.items()
        if name.startswith('original/')}
    inputs = {}
    for path in SUBJECT.PINS:
        if path.parent == SUBJECT.REPAIR:
            local = HERE.parent/'ledger-balance-repair'/path.name
            inputs[path] = local.read_bytes()
        else:
            name = ('repair-' + path.name.split('-')[0] + '.json' if path.parent == SUBJECT.AUDIT else
                'diagnostic-owner.py' if path.suffix == '.py' else
                'partial-audit.json' if 'reconciliation.' in str(path) else
                'reminder-proof.json' if 'reminder-continuity.' in str(path) else 'diagnostic-baseline.json')
            inputs[path] = contents[name]
    if any(hashlib.sha256(value).hexdigest() != SUBJECT.PINS[path] for path, value in inputs.items()):
        raise ValueError('private input changed')
    diagnostic_path = next(path for path in inputs if 'baci-project-rollback-bootstrap.' in str(path))
    diagnostic = SUBJECT.module(inputs[diagnostic_path], diagnostic_path)

    def read(path, pin):
        value = original[path.name] if path.parent == LEGACY.ROOT else inputs[path]
        if hashlib.sha256(value).hexdigest() != pin:
            raise ValueError('offline pin mismatch')
        return value

    diagnostic.protected_root_read = read
    bootstrap = diagnostic.bootstrap

    def offline_bootstrap(captured):
        owner, readiness, finder = bootstrap(captured)
        readiness._protected_read = read
        return owner, readiness, finder

    diagnostic.bootstrap = offline_bootstrap
    return inputs, original, LEGACY.Legacy(diagnostic, {name: value for name, value in original.items()
        if name != 'release.json'}), read


class ContinuationEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.inputs, self.original, self.namespace, self.read = fixtures()

    def test_actual_authenticated_chain_preserves_exact_failed_queue_delta_and_reminders(self):
        original = copy.deepcopy(self.inputs)
        with self.namespace.scope() as modules:
            after, owner = SUBJECT.verify(self.inputs, modules)
        self.assertTrue(after['checker']['prosecdef'])
        witness = after['normal']['protectedSnapshot']['allowedTargetWitnesses']['savings_notifications.events']
        self.assertEqual((witness['targetCount'], witness['excludedTargetCount']), (1, 7))
        self.assertEqual(self.inputs, original)

    def test_every_retained_source_or_report_byte_mutation_refuses_before_source_execution(self):
        for path in self.inputs:
            with self.subTest(path=path.name):
                changed = dict(self.inputs, **{})
                changed[path] += b' '
                with patch.object(SUBJECT, 'module') as execute, self.assertRaises(ValueError):
                    SUBJECT.verify(changed, {})
                execute.assert_not_called()

    def test_actual_chain_rejects_unrelated_rows_auth_and_checker_metadata_drift(self):
        with self.namespace.scope() as modules:
            actual_decode = SUBJECT.decode
            for selected in ('auth', 'checker', 'hidden', 'non-target'):
                with self.subTest(selected=selected):
                    def decode(raw):
                        value = actual_decode(raw)
                        if type(value) is dict and set(value) == {'normal', 'masked', 'checker'}:
                            value = copy.deepcopy(value)
                            if selected == 'checker' and value['checker']['prosecdef']:
                                value['checker']['proowner'] = 'foreign'
                            else:
                                snapshot = value['normal']['protectedSnapshot']
                                if selected == 'auth':
                                    snapshot['tableRows']['auth.users']['sha256'] = 'a' * 64
                                else:
                                    witness = snapshot['allowedTargetWitnesses']['savings_notifications.events']
                                    if selected == 'hidden':
                                        witness['targetRowColumnHashes'][0]['body'] = 'a' * 64
                                    else:
                                        witness['excludedTargetHash'] = 'a' * 64
                        return value
                    with patch.object(SUBJECT, 'decode', side_effect=decode), self.assertRaises(ValueError):
                        SUBJECT.verify(self.inputs, modules)

    def test_counterfeit_failed_queue_delta_and_unrelated_state_refuse(self):
        partial = SUBJECT.decode(self.inputs[next(path for path in self.inputs
            if 'reconciliation.' in str(path))])['firstPost']
        baseline = SUBJECT.decode(self.inputs[next(path for path in self.inputs
            if 'baci-project-rollback-tls.' in str(path))])['protectedSnapshot']
        relation = 'prefunded_card.dispatch_queue'
        for selected in ('attempts', 'schedule', 'token-hash', 'retired', 'count', 'auth', 'metadata'):
            with self.subTest(selected=selected):
                changed = copy.deepcopy(baseline)
                witness = changed['allowedTargetWitnesses'][relation]
                if selected == 'attempts':
                    witness['targetRows'][0]['attempts'] += 1
                elif selected == 'schedule':
                    witness['targetRows'][0]['available_at'] = '2026-10-03T11:36:06+00:00'
                elif selected == 'token-hash':
                    witness['targetRowColumnHashes'][0]['claim_token'] = 'a' * 64
                elif selected == 'retired':
                    witness['excludedTargetHash'] = 'a' * 64
                elif selected == 'count':
                    changed['tableRows'][relation]['count'] += 1
                elif selected == 'auth':
                    changed['tableRows']['auth.users']['sha256'] = 'a' * 64
                else:
                    changed['permanentMetadataSha256'] = 'a' * 64
                with self.assertRaises(ValueError):
                    SUBJECT.failed_queue_delta(partial, changed)


if __name__ == '__main__':
    unittest.main()
