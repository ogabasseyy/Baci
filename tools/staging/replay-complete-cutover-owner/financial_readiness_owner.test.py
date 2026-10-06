import copy
from contextlib import nullcontext
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import application_reports
import natural_reclaim_authority as natural
import worker_source_authority as worker

try:
    import financial_readiness_owner as module
except ModuleNotFoundError:
    module = None


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('readiness_report_fixture', HERE/'application_reports.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
SPEC = importlib.util.spec_from_file_location('readiness_catalog_fixture', HERE/'natural_reclaim_authority.test.py')
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


class FinancialReadinessTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'read-only composition not implemented')
        self.directory = HERE
        self.blobs = {name: (HERE/name).read_bytes() if (HERE/name).is_file() else b'unused' for name in module.FILES}
        for source, name in module.SOURCE_NAMES.items():
            path = HERE.parent/'prefunded-card'/source if '/' not in source else HERE.parents[2]/source
            self.blobs[name] = path.read_bytes()
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.blobs.items()}
        self.application, self.original, self.provider = FIXTURE.inputs()
        self.background = dict(blockers=['verification_leases'], phase='verify_existing_transfer')
        self.bundle = dict(status='stopped-provider-and-application-readonly-verified',
            application=self.application, original=self.original, provider=self.provider, background=self.background,
            quiescenceBefore={'status':'financial-writers-quiescent'}, quiescenceAfter={'status':'financial-writers-quiescent'},
            financialActionAttempted=False, newPaymentStarted=False)
        fixture = CATALOG.NaturalReclaimTests('runTest')
        fixture.setUp()
        self.catalog = fixture.report
        self.catalog['capturedAt'] = '2026-10-03T07:48:00.000000Z'
        self.context = SimpleNamespace(owner=SimpleNamespace(read=Mock(side_effect=self.read)),
            finance={'database': Mock(return_value=json.dumps(self.catalog))}, deadline=Mock(), lock=20)
        self.provider_module = SimpleNamespace(FILES=module.STOPPED_FILES,
            collect_stopped_provider=Mock(side_effect=lambda *args: copy.deepcopy(self.bundle)))
        self.worker_report = dict(status='worker-source-inputs-bound', containerId=worker.BACKGROUND_CONTAINER_ID,
            manifestSha256=worker.MANIFEST_SHA256, originalConfigurationSha256=worker.ORIGINAL_CONFIGURATION_SHA256,
            configurationSha256=worker.CONFIGURATION_SHA256, schedulerSha256=worker.SCHEDULER_SHA256)
        self.scheduler = SimpleNamespace(__file__='/root/baci-financial-owner.2ynkl9kc/bundle-r8/tooling/runtime_scheduler.py')
        self.worker_module = SimpleNamespace(collect_worker_authority=Mock(return_value=(self.worker_report, self.scheduler)))
        self.binder = Mock(return_value=self.scheduler)
        self.quiet = Mock(return_value={'status':'financial-writers-quiescent'})
        self.modules = dict(stopped_provider_preflight=self.provider_module,
            application_reports=application_reports, natural_reclaim_authority=natural,
            worker_owner=self.worker_module, sealed_scheduler=SimpleNamespace(bind_sealed_scheduler=self.binder),
            financial_quiescence=SimpleNamespace(verify_financial_quiescence=self.quiet))
        self.clock = datetime(2026, 10, 3, 7, 48, 10, tzinfo=timezone.utc)

    def read(self, path, pin, **kwargs):
        return self.blobs[Path(path).name]

    def execute(self):
        with (patch.object(module, '_load_modules', return_value=self.modules),
              patch.object(module, '_locked'), patch.object(module, 'datetime') as clock,
              patch.object(application_reports, 'datetime') as application_clock):
            for current in (clock, application_clock):
                current.now.return_value = self.clock
                current.fromisoformat.side_effect = datetime.fromisoformat
            return module.collect_financial_readiness(self.context, self.directory, self.pins)

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^financial_readiness_refused$'):
            self.execute()

    def test_uses_actual_assembled_reports_and_observed_catalog_only_as_review_candidate(self):
        result = self.execute()
        summary = result['summary']
        self.assertEqual(summary['catalogSha256'], self.catalog['catalogSha256'])
        self.assertIs(summary['catalogReviewCandidate'], True)
        self.assertIs(summary['financialActionAuthorized'], False)
        self.assertEqual(summary['nativeEvidenceRows'], 1)
        self.assertIs(summary['originalProcessed'], True)
        self.assertIs(summary['workerAuthorityBound'], True)
        self.assertNotIn('financialProofPassed', json.dumps(result))
        self.assertNotIn('safelyNaturallyReclaimable', json.dumps(result))
        actual_pins = self.provider_module.collect_stopped_provider.call_args.args[2]
        self.assertEqual(set(actual_pins), set(module.STOPPED_FILES))
        loader = self.worker_module.collect_worker_authority.call_args.kwargs['load_scheduler']
        loader(Path('/sealed'), {'pin':'value'})
        self.binder.assert_called_once_with(self.context, Path('/sealed'), {'pin':'value'})
        self.assertEqual(self.context.finance['database'].call_count, 1)
        self.assertTrue(self.context.finance['database'].call_args.args[0].rstrip().endswith('ROLLBACK;'))

    def test_closed_package_and_six_canonical_sources_refuse_before_any_private_collection(self):
        base = dict(self.pins)
        for kind in ('missing', 'extra', 'invalid', 'drift', 'canonical'):
            self.pins = dict(base)
            if kind == 'missing': self.pins.pop('sealed_scheduler.py')
            elif kind == 'extra': self.pins['foreign.py'] = 'a'*64
            elif kind == 'invalid': self.pins['receipt_report.sql'] = True
            elif kind == 'drift': self.blobs['provider_crosswalk.cjs'] += b'drift'
            else:
                self.blobs['claim-boundary.sql'] += b'drift'
                self.pins['claim-boundary.sql'] = hashlib.sha256(self.blobs['claim-boundary.sql']).hexdigest()
            with self.subTest(kind=kind): self.refused()
        self.provider_module.collect_stopped_provider.assert_not_called()
        self.worker_module.collect_worker_authority.assert_not_called()

    def test_native_scope_boolean_missing_evidence_and_hmac_failure_never_reach_worker(self):
        for kind in ('scope', 'boolean', 'absent', 'hmac'):
            self.setUp()
            if kind == 'scope': self.application['nativeApplication']['scope']['operationId'] = natural.OLD
            elif kind == 'boolean': self.application['nativeApplication']['evidence'][0]['conflicted'] = 0
            elif kind == 'absent': self.application['nativeApplication']['evidence'] = []
            else: self.original['provenance']['hmacSha512Verified'] = False
            with self.subTest(kind=kind): self.refused()
            self.worker_module.collect_worker_authority.assert_not_called()

    def test_unprocessed_receipt_false_work_proof_or_integer_flags_refuse(self):
        self.original['receiptStorage']['status'] = 'quarantined'
        self.refused()
        self.setUp()
        self.bundle['financialActionAttempted'] = 0
        self.refused()
        self.setUp()
        self.worker_report['status'] = 'foreign'
        self.refused()

    def test_actual_catalog_oid_body_trigger_and_identity_drift_refuse(self):
        for kind in ('oid', 'body', 'trigger', 'readonly', 'physical', 'closure', 'stale'):
            self.setUp()
            if kind == 'oid': self.catalog['routines'][natural.CLAIMS[0]]['oid'] = 1
            elif kind == 'body': self.catalog['routines'][natural.CLAIMS[1]]['bodySha256'] = 'f'*64
            elif kind == 'trigger': self.catalog['triggers'][0]['enabled'] = 'D'
            elif kind == 'readonly': self.catalog['identity']['readOnly'] = 1
            elif kind == 'physical': self.catalog['identity']['systemIdentifier'] = 'other'
            elif kind == 'closure': self.catalog['sourceClosureSha256'] = 'f'*64
            else: self.catalog['capturedAt'] = '2026-10-03T07:44:00.000000Z'
            self.context.finance['database'].return_value = json.dumps(self.catalog)
            with self.subTest(kind=kind): self.refused()

    def test_postcollection_quiescence_or_package_drift_never_returns_readiness(self):
        self.quiet.side_effect = ValueError('PRIVATE_SECRET')
        self.refused()
        self.setUp()
        def database(source):
            self.blobs['financial_report.sql'] += b'drift'
            return json.dumps(self.catalog)
        self.context.finance['database'].side_effect = database
        self.refused()

    def test_main_sanitizes_release_failure_and_never_builds_context_before_pins_pass(self):
        with (patch.object(module.os, 'geteuid', return_value=0),
              patch.object(module, '_protected_read', side_effect=ValueError('/root/PRIVATE_SECRET')),
              patch.object(module, '_load_modules') as loader, patch('sys.stdout', new_callable=io.StringIO) as output):
            self.assertEqual(module.main(['a'*64]), 1)
        loader.assert_not_called()
        response = json.loads(output.getvalue())
        self.assertTrue(response['redacted'])
        self.assertNotIn('PRIVATE_SECRET', output.getvalue())
        self.assertNotIn('/root', output.getvalue())

    def test_optimized_execution_refuses_before_private_reads_or_imports(self):
        with (patch.object(module.sys, 'flags', SimpleNamespace(optimize=1)),
              patch.object(module.os, 'geteuid', return_value=0),
              patch.object(module, '_protected_read') as read, patch.object(module, '_load_modules') as loader,
              patch('sys.stdout', new_callable=io.StringIO) as output):
            self.assertEqual(module.main(['a'*64]), 1)
        read.assert_not_called()
        loader.assert_not_called()
        self.assertTrue(json.loads(output.getvalue())['redacted'])

    def test_package_lists_only_reviewed_flat_files_and_never_frozen_worker_adapter(self):
        self.assertEqual(len(module.PROVIDER_FILES), 14)
        self.assertEqual(module.PROVIDER_FILES, __import__('provider_preflight').FILES)
        self.assertEqual(set(module.SOURCE_NAMES), set(natural.SOURCE_FILES))
        self.assertEqual(module.SOURCE_NAMES[natural.MIGRATION], 'claim-boundary.sql')
        self.assertNotIn('worker_adapter.py', module.FILES)
        self.assertTrue(all(Path(name).name == name for name in module.FILES))
        self.assertLess(len((HERE/'financial_readiness_owner.py').read_text().splitlines()), 300)

    def test_selfpinned_noncanonical_source_release_is_refused_before_context_construction(self):
        self.blobs['claim-boundary.sql'] += b'drift'
        self.pins['claim-boundary.sql'] = hashlib.sha256(self.blobs['claim-boundary.sql']).hexdigest()
        release = json.dumps(dict(kind=module.KIND, files=self.pins)).encode()
        context_type = Mock(return_value=self.context)
        self.modules['cutover_context'] = SimpleNamespace(Context=context_type)
        def read(path, pin):
            return release if Path(path).name == 'release.json' else self.read(path, pin)
        with (patch.object(module.os, 'geteuid', return_value=0),
              patch.object(module, '_protected_read', side_effect=read),
              patch.object(module, '_load_modules', return_value=self.modules),
              patch('sys.stdout', new_callable=io.StringIO)):
            self.assertEqual(module.main([hashlib.sha256(release).hexdigest()]), 1)
        context_type.assert_not_called()

    def info(self, mode=stat.S_IFREG | 0o600, gid=0, links=1, inode=1, size=4):
        return SimpleNamespace(st_dev=1, st_ino=inode, st_mode=mode, st_uid=0, st_gid=gid,
            st_nlink=links, st_size=size, st_mtime_ns=1, st_ctime_ns=1)

    def test_bootstrap_reader_rejects_wrong_ancestor_gid_symlinks_or_writes_before_open(self):
        path = Path('/root/package/code.py')
        pin = hashlib.sha256(b'code').hexdigest()
        for info in (self.info(stat.S_IFDIR | 0o755, gid=65532),
            self.info(stat.S_IFLNK | 0o755), self.info(stat.S_IFDIR | 0o777)):
            with (patch.object(Path, 'lstat', return_value=info), patch.object(module.os, 'open') as opened,
                  self.assertRaisesRegex(ValueError, '^financial_readiness_refused$')):
                module._protected_read(path, pin)
            opened.assert_not_called()

    def test_bootstrap_reader_checks_file_gid_links_and_opened_after_metadata(self):
        path = Path('/root/package/code.py')
        pin = hashlib.sha256(b'code').hexdigest()
        normal = self.info()
        parent = self.info(stat.S_IFDIR | 0o755)
        for changed in (self.info(gid=65532), self.info(links=2), self.info(inode=2)):
            handle = SimpleNamespace(fileno=lambda: 99, read=lambda limit: b'code')
            with (patch.object(Path, 'lstat', lambda observed: normal if observed == path else parent),
                  patch.object(module.os, 'open', return_value=99),
                  patch.object(module.os, 'fdopen', return_value=nullcontext(handle)),
                  patch.object(module.os, 'fstat', side_effect=[normal, changed]),
                  self.assertRaisesRegex(ValueError, '^financial_readiness_refused$')):
                module._protected_read(path, pin)

    def test_context_lock_identity_or_exclusive_lock_failure_refuses(self):
        for observed in (self.info(inode=2), self.info(gid=65532), self.info(links=2)):
            with (patch.object(module.os, 'fstat', return_value=self.info()),
                  patch.object(Path, 'lstat', return_value=observed),
                  self.assertRaisesRegex(ValueError, '^financial_readiness_refused$')):
                module._locked(self.context)
        with (patch.object(module.os, 'fstat', return_value=self.info()),
              patch.object(Path, 'lstat', return_value=self.info()),
              patch.object(module.fcntl, 'flock', side_effect=BlockingIOError()), self.assertRaises(BlockingIOError)):
            module._locked(self.context)

    def test_main_journals_only_private_audit_and_prints_compact_noaction_candidate(self):
        result = self.execute()
        release = json.dumps(dict(kind=module.KIND, files=self.pins)).encode()
        self.context.journal = Mock()
        self.modules['cutover_context'] = SimpleNamespace(Context=Mock(return_value=self.context))
        def read(path, pin):
            return release if Path(path).name == 'release.json' else self.read(path, pin)
        with (patch.object(module.os, 'geteuid', return_value=0),
              patch.object(module, '_protected_read', side_effect=read),
              patch.object(module, '_load_modules', return_value=self.modules),
              patch.object(module, 'collect_financial_readiness', return_value=result),
              patch.object(module.tempfile, 'mkdtemp', return_value='/root/private-audit'),
              patch.object(module.os, 'chmod'), patch.object(module.os, 'close'),
              patch('sys.stdout', new_callable=io.StringIO) as output):
            self.assertEqual(module.main([hashlib.sha256(release).hexdigest()]), 0)
        self.assertEqual(json.loads(output.getvalue()), result['summary'])
        self.assertNotIn('/root', output.getvalue())
        self.context.journal.assert_called_once_with(Path('/root/private-audit'), 'readonly-review-candidate', result)


if __name__ == '__main__':
    unittest.main()
