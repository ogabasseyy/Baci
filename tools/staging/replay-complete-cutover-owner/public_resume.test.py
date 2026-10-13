import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import financial_completion
import financial_delta
import cutover_runtime
import completion_snapshot
def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module
FIXTURES = load('resume_financial_fixtures', HERE / 'financial_completion.test.py')
SNAPSHOTS = load('resume_snapshot_fixtures', HERE / 'completion_snapshot.test.py')
MODULE = load('public_resume', HERE / 'public_resume.py') if (HERE / 'public_resume.py').exists() else None
CID = 'c6e802349659140803be6b5c2c2f79fca6036f8cbaad50598d67da573d33fa5c'
ROOT = '/opt/baci-prefunded-public'
UNIT = '/etc/systemd/system/baci-prefunded-public.service'
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
NOW = datetime(2026, 10, 3, 7, 48, 5, tzinfo=timezone.utc)
def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def digest(raw):
    return hashlib.sha256(raw).hexdigest()
class Host:
    def __init__(self):
        self.files = {ROOT + '/app/launch-public.cjs': b'launcher', ROOT + '/app/apps/web/server.js': b'server',
            ROOT + '/config/checkout.json': b'private-checkout', ROOT + '/config/anon.json': b'private-anon'}
        self.manifest_path = '/root/reviewed-public/public-app.manifest.json'
        self.files[self.manifest_path] = encoded(dict(version=1, count=2, bytes=14, tarballSize=100,
            tarballSha256='a' * 64, files=[dict(path=path.removeprefix(ROOT + '/app/'),
            sha256=digest(raw), size=len(raw)) for path, raw in self.files.items() if '/app/' in path]))
        self.files[UNIT] = ("[Unit]\nRequires=docker.service baci-prefunded-public-deadline.timer\n"
            "[Service]\nType=simple\nExecCondition=/bin/sh -c 'test \"$(/bin/date -u +%%s)\" -lt \"1791302350\"'\n"
            "ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock start --attach baci-prefunded-public\n"
            "ExecStopPost=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 5 baci-prefunded-public\n"
            "Restart=no\n").encode()
        self.source_paths = [str(HERE / 'public_resume.py'), __file__, *(str(Path(module.__file__).resolve())
            for module in (financial_completion, financial_delta, cutover_runtime, completion_snapshot))]
        for path in self.source_paths:
            self.files[path] = Path(path).read_bytes() if Path(path).exists() else b'not-yet-implemented'
        self.contract = dict(Image='sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553',
            Config=dict(User='65530:65530', WorkingDir='/app/apps/web',
                Cmd=['/usr/local/bin/node', '/app/launch-public.cjs'], Entrypoint=['docker-entrypoint.sh'],
                Env=['NODE_ENV=production'], Labels={'com.baci.prefunded.public-manifest': digest(self.files[self.manifest_path])}),
            HostConfig=dict(ReadonlyRootfs=True, Privileged=False, CapDrop=['ALL'], RestartPolicy=dict(Name='no', MaximumRetryCount=0)),
            Mounts=[dict(Type='bind', Source=ROOT + '/app', Destination='/app', RW=False),
                *[dict(Type='bind', Source=ROOT + '/config/' + name + '.json',
                    Destination='/run/pvb-public/' + name + '.json', RW=False) for name in ('checkout', 'anon')]],
            networks=['baci-isolated-savings_database', 'pvb-staging-intake-ingress'])
        self.contract['Mounts'].sort(key=lambda mount: mount['Destination'])
        self.authority = dict(manifestPath=self.manifest_path, container=self.contract,
            configPins={path: digest(self.files[path]) for path in self.files if '/config/' in path},
            sources={path: digest(self.files[path]) for path in self.source_paths})
        self.running, self.start_count, self.stop_count = False, 0, 0
        self.operations, self.fail_start, self.fail_stop, self.replacement = [], False, False, False
        self.report = FIXTURES.completed_fixture()
        self.snapshot = SNAPSHOTS.consistent_snapshot(self.report)
        self.after, self.metadata_change, self.unit_change, self.read_failure = None, None, None, None
        self.now, self.started_at, self.delay_collection = NOW, NOW, False
        self.job_pending = False
    def start_job_state(self, service, submitted_at):
        return dict(unit=service, submittedAt=submitted_at.isoformat().replace('+00:00', 'Z'),
            observedAt=self.now.isoformat().replace('+00:00', 'Z'), jobId=47,
            terminal=not self.job_pending, pendingJobs=[47] if self.job_pending else [], activating=self.job_pending)
    def read(self, path, *, mode):
        path = str(path)
        if path == self.read_failure:
            raise ValueError('secret-read-error')
        metadata = dict(uid=1001 if path == self.metadata_change else 0, gid=65530 if path in self.authority['configPins'] else 0, mode=mode, nlink=1, regularFile=True)
        return self.files[path], metadata
    def inventory(self, path):
        return sorted(name for name in self.files if name.startswith(str(path) + '/'))
    def inspect(self, identifier):
        assert identifier == CID
        observed = copy.deepcopy(self.contract)
        observed.update(Id='f' * 64 if self.replacement else CID, Name='/baci-prefunded-public',
            State=dict(Running=self.running, Paused=False, Restarting=False, Dead=False,
                OOMKilled=False, Status='running' if self.running else 'exited', ExitCode=0))
        return observed
    def unit_state(self):
        value = dict(FragmentPath=UNIT, DropInPaths=[], NeedDaemonReload=False, LoadState='loaded',
            Transient=False, Restart='no', ActiveState='active' if self.running else 'inactive',
            SubState='running' if self.running else 'dead', Result='success', ExecMainStatus=0,
            InvocationID='2' * 32 if self.running else '1' * 32, MainPID=42 if self.running else 0,
            startedAt=self.started_at.isoformat().replace('+00:00', 'Z'),
            commands=dict(ExecCondition=['/bin/sh', '-c', 'test "$(/bin/date -u +%s)" -lt "1791302350"'],
                ExecStart=[*DOCKER, 'start', '--attach', 'baci-prefunded-public'],
                ExecStopPost=[*DOCKER, 'stop', '--time', '5', 'baci-prefunded-public']))
        if self.unit_change:
            value.update(self.unit_change)
        return value
    def collect_completed(self):
        report = copy.deepcopy(self.after if self.running and self.after else self.report)
        if self.delay_collection:
            self.now += timedelta(seconds=1)
            report['observedAt'] = self.now.isoformat().replace('+00:00', 'Z')
            FIXTURES.refresh_native(report['nativeEvidence'], report['observedAt'])
            self.snapshot['capturedAt'] = report['observedAt']
        return dict(completed=report, protectedSnapshot=copy.deepcopy(self.snapshot))
    def deadline(self):
        return dict(epoch=1791302350, active=True, stopTarget='baci-prefunded-public')
    def exclusive(self):
        return True
    def run(self, arguments, *, timeout):
        self.operations.append((arguments, timeout))
        if arguments == ['/usr/bin/systemctl', 'start', 'baci-prefunded-public.service']:
            self.start_count += 1
            self.running = True
            self.started_at = self.now
            if self.fail_start:
                raise TimeoutError('private-provider-secret')
        elif arguments == [*DOCKER, 'stop', '--time', '5', CID]:
            self.stop_count += 1
            if self.fail_stop:
                raise ValueError('private-stop-error')
            self.running = False
        else:
            raise AssertionError('unexpected mutation')
    def resume(self):
        return MODULE.resume_public(reviewed=self.authority, reviewed_sha256=digest(encoded(self.authority)),
            read=self.read, inventory=self.inventory, inspect=self.inspect, unit_state=self.unit_state,
            collect_completed=self.collect_completed, deadline=self.deadline, exclusive=self.exclusive,
            run=self.run, clock=lambda: self.now, start_job_state=self.start_job_state)
class PublicResumeTests(unittest.TestCase):
    def setUp(self):
        self.host = Host()
        self.pins = patch.multiple(MODULE, MANIFEST_PIN=digest(self.host.files[self.host.manifest_path]),
            UNIT_PIN=digest(self.host.files[UNIT]))
        self.pins.start()
        self.addCleanup(self.pins.stop)
    def refused(self, attempted=False):
        result = self.host.resume()
        self.assertEqual(result['status'], 'public-resume-refused')
        self.assertIs(result['startAttempted'], attempted)
        return result
    def test_resumes_only_existing_service_after_parent_validated_completion(self):
        result = self.host.resume()
        self.assertEqual(result['status'], 'public-service-resumed')
        self.assertTrue(result['protectedStateUnchanged'])
        self.assertFalse(result['httpAcceptanceVerified'])
        self.assertEqual(self.host.operations, [(['/usr/bin/systemctl', 'start', 'baci-prefunded-public.service'], 30)])
    def test_regression_completed_report_with_unapplied_empty_snapshot_never_starts(self):
        for relation in financial_delta.INSERTIONS:
            witness = self.host.snapshot['allowedTargetWitnesses'][relation]
            witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
            self.host.snapshot['tableRows'][relation]['count'] = witness['excludedTargetCount']
        self.refused()
        self.assertEqual(self.host.operations, [])
    def test_completed_report_cannot_hide_actual_unfunded_goal_or_unconsumed_treasury(self):
        for relation, field in (('public.customer_savings_goals', 'current_amount'),
            ('prefunded_card.treasury_bindings', 'consumed_kobo')):
            self.host = Host()
            self.host.snapshot['allowedTargetWitnesses'][relation]['targetRows'][0][field] = 0
            self.refused()
    def test_parent_validator_must_return_positive_binding_proof(self):
        for value in (None, False, {}, dict(snapshotCompletionBound=False)):
            with patch.object(MODULE.snapshot_binding, 'verify_completion_snapshot', return_value=value):
                self.refused()
    def test_regression_reused_snapshot_cannot_hide_nested_poststart_drift(self):
        def reused():
            if self.host.running:
                self.host.snapshot['tableRows']['public.synthetic_unrelated']['sha256'] = '9' * 64
            return dict(completed=copy.deepcopy(self.host.report), protectedSnapshot=self.host.snapshot)
        self.host.collect_completed = reused
        result = self.refused(True)
        self.assertTrue(result['ownedContainerStopped'])
        self.assertIsNone(result['protectedStateUnchanged'])
    def test_regression_timed_out_pending_job_cannot_confirm_stopped_cleanup(self):
        self.host.fail_start, self.host.job_pending = True, True
        result = self.refused(True)
        self.assertIsNone(result['ownedContainerStopped'])
        self.assertIs(result['startJobTerminal'], False)
        self.assertEqual((self.host.start_count, self.host.stop_count), (1, 1))
    def test_regression_raw_mount_fields_and_order_do_not_refuse_exact_mounts(self):
        original = self.host.inspect
        def raw(identifier):
            value = original(identifier)
            value['Mounts'].reverse()
            for mount in value['Mounts']:
                mount.update(Mode='ro', Propagation='rprivate')
            return value
        self.host.inspect = raw
        self.assertEqual(self.host.resume()['status'], 'public-service-resumed')
    def test_extra_duplicate_or_writable_mounts_are_never_discarded(self):
        for change in ('extra', 'duplicate', 'writable'):
            self.host = Host()
            mounts = self.host.contract['Mounts']
            if change == 'writable':
                mounts[0]['RW'] = True
            else:
                mounts.append(dict(mounts[0], Destination='/extra') if change == 'extra' else dict(mounts[0]))
            self.refused()
    def test_regression_refuses_dispatching_or_unapplied_operation_before_start(self):
        for field, value in (('transferStatus', 'dispatching'), ('projectionStatus', 'unapplied')):
            self.host = Host()
            self.host.report['operation'][field] = value
            self.refused()
    def test_refuses_nonexhausted_cap_replenishment_reservation_or_changed_plans(self):
        for key, value in (('budgetKobo', 20000), ('replenishedKobo', 10000),
            ('reservedKobo', 1), ('consumedKobo', 9999)):
            self.host = Host()
            self.host.report['treasury'][key] = value
            self.refused()
        for index in (0, 1):
            self.host = Host()
            self.host.report['goals'][index]['displayedPrincipalKobo'] = 0
            self.refused()
    def test_stale_financial_report_or_write_snapshot_refuses_before_start(self):
        self.host.report['observedAt'] = '2026-10-03T07:46:00Z'
        self.refused()
        self.host = Host()
        self.host.snapshot['readOnly'] = False
        self.refused()
    def test_readonly_preflight_rejects_missing_inputs_and_runtime_drift(self):
        cases = [('configPin', ROOT + '/config/checkout.json', None), ('sourcePin', __file__, None),
            ('sourcePin', str(Path(completion_snapshot.__file__).resolve()), None),
            ('metadata_change', None, str(HERE / 'public_resume.py')),
            *[('file', path, b'unreviewed') for path in (ROOT + '/config/checkout.json',
                ROOT + '/app/injected.cjs', str(HERE / 'public_resume.py'))],
            *[('unit_change', None, change) for change in (dict(commands={}),
                dict(DropInPaths=['/tmp/override']), dict(NeedDaemonReload=True))],
            ('replacement', None, True), ('running', None, True),
            ('read_failure', None, self.host.manifest_path),
            ('now', None, datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)),
            ('exclusive', None, lambda: False), ('start_job_state', None, None)]
        for kind, key, value in cases:
            with self.subTest(kind=kind, key=key, value=value):
                self.host = Host()
                if kind in ('configPin', 'sourcePin'):
                    del self.host.authority['configPins' if kind == 'configPin' else 'sources'][key]
                elif kind == 'file':
                    self.host.files[key] = value
                else:
                    setattr(self.host, kind, value)
                self.refused()
                self.assertEqual((self.host.start_count, self.host.stop_count), (0, 0))
    def test_timeout_with_unknown_stale_or_contradictory_job_proof_is_unconfirmed(self):
        cases = [dict(jobId=None), dict(unit='foreign.service'), dict(observedAt='2026-10-03T07:46:00Z'),
            dict(submittedAt='2026-10-03T07:47:59Z'), dict(terminal=True, pendingJobs=[47]),
            dict(terminal=True, activating=True)]
        for update in cases:
            self.host = Host()
            self.host.fail_start = True
            original = self.host.start_job_state
            def changed(service, submitted_at):
                value = original(service, submitted_at)
                value.update(update)
                return value
            self.host.start_job_state = changed
            self.assertIsNone(self.refused(True)['ownedContainerStopped'])
    def test_partial_start_failure_stops_only_owned_id_and_redacts_error(self):
        self.host.fail_start = True
        result = self.refused(True)
        self.assertTrue(result['ownedContainerStopped'])
        self.assertTrue(result['startJobTerminal'])
        self.assertEqual(self.host.stop_count, 1)
        self.assertNotIn('private', json.dumps(result))
    def test_poststart_financial_drift_stops_owned_id_without_claiming_unchanged(self):
        self.host.after = copy.deepcopy(self.host.report)
        self.host.after['treasury']['consumedKobo'] = 20000
        result = self.refused(True)
        self.assertTrue(result['ownedContainerStopped'])
        self.assertIsNone(result['protectedStateUnchanged'])
    def test_cleanup_failure_is_unconfirmed_and_never_restarts_or_retries(self):
        self.host.fail_start, self.host.fail_stop = True, True
        self.assertIs(self.refused(True)['ownedContainerStopped'], False)
        self.assertEqual((self.host.start_count, self.host.stop_count), (1, 1))
    def test_fresh_collection_captured_during_callback_is_not_rejected_as_future(self):
        self.host.delay_collection = True
        self.assertEqual(self.host.resume()['status'], 'public-service-resumed')
    def test_identity_replacement_during_start_is_never_stopped_as_owned(self):
        original = self.host.run
        def replaced(arguments, *, timeout):
            original(arguments, timeout=timeout)
            self.host.replacement = True
        self.host.run = replaced
        self.assertIsNone(self.refused(True)['ownedContainerStopped'])
        self.assertEqual(self.host.stop_count, 0)
    def test_full_protected_snapshot_drift_stops_public_without_claiming_preservation(self):
        original = self.host.collect_completed
        def changed():
            result = original()
            if self.host.running:
                result['protectedSnapshot']['permanentMetadataSha256'] = 'f' * 64
            return result
        self.host.collect_completed = changed
        result = self.refused(True)
        self.assertTrue(result['ownedContainerStopped'])
        self.assertIsNone(result['protectedStateUnchanged'])
if __name__ == '__main__':
    unittest.main()
