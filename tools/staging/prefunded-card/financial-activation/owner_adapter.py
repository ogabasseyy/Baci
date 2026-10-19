from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

from installation_contract import verify_seal
from installation_runtime import CONTAINER, PREFIX, inspect
from installation_units import properties, verify_deadlines
from owner_database import renewal_proof
from protected_snapshot import prove_unchanged, snapshot_sql
from release_contract import _json, _require

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from runtime_owner_support import DOCKER, command, database

HEARTBEAT = "process.stdout.write(require('node:fs').readFileSync('/tmp/replay-heartbeat','utf8'))"


class FinancialOwnerAdapter:
    def __init__(self, installation, renewal_audit, evidence_request, public_probe):
        self.installation, self.renewal_audit = installation, renewal_audit
        self.request, self.public_probe = evidence_request, public_probe
        self.started_at = None
        self.passes = {}
        self.payment_before = _json(database(snapshot_sql().decode()).encode())

    def verify_seal(self, expected_sha):
        return verify_seal(self.installation.bundle, expected_sha) == self.installation.seal

    def evidence(self, phase):
        from readiness_evidence import collect
        started = time.time()
        request = {**self.request, 'phase': phase}
        proof = renewal_proof(self.renewal_audit)
        public = self.public_probe()
        report = collect(request)
        report.update(proof, public=public)
        if phase == 'preschedule':
            report['freshReplayCompletedPass'] = self.replay_completed_pass_is_fresh()
        _require(0 <= time.time() - started <= 60, 'owner_evidence_collection_stale')
        report['observedAt'] = datetime.now(timezone.utc).isoformat()
        return report

    def prestart_evidence(self):
        return self.evidence('prestart')

    def preschedule_evidence(self):
        return self.evidence('preschedule')

    def start_replay(self):
        self.started_at = time.time()
        command([*DOCKER, 'start', CONTAINER])

    def replay_completed_pass_is_fresh(self):
        _require(self.started_at is not None, 'owner_replay_not_started')
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            _require(time.time() < 1791301750 and inspect(CONTAINER)['State']['Running'] is True,
                     'owner_replay_stopped_or_expired')
            try:
                value = command([*DOCKER, 'exec', '--user=65532:65532', CONTAINER,
                    'node', '-e', HEARTBEAT], timeout=10).strip()
                if (value.isdecimal() and len(value) == 13
                        and self.started_at * 1000 <= int(value) <= time.time() * 1000
                        and time.time() * 1000 - int(value) <= 120000):
                    return True
            except Exception:
                pass
            time.sleep(1)
        return False

    def run_once(self, kind):
        before = datetime.now(timezone.utc)
        command(['/usr/bin/systemctl', 'start', PREFIX + kind + '.service'],
                timeout=500 if kind == 'background' else 60)
        state = properties(PREFIX + kind + '.service', ('Result', 'ExecMainStatus', 'ActiveState'))
        _require(state == {'Result': 'success', 'ExecMainStatus': '0', 'ActiveState': 'inactive'},
                 'owner_scheduled_oneshot_failed')
        observed = inspect(PREFIX + kind)
        started = observed['State']['StartedAt']
        _require(datetime.fromisoformat(started.replace('Z', '+00:00')) >= before
                 and observed['State']['Running'] is False and observed['State']['ExitCode'] == 0,
                 'owner_scheduled_oneshot_not_fresh')
        report = _json(command([*DOCKER, 'logs', '--since', started, PREFIX + kind]).encode())
        accepted = {'background': [{'status': 'completed'}],
                    'snapshot': [{'outcome': 'recorded'}, {'outcome': 'duplicate'}]}
        _require(report in accepted[kind], 'owner_scheduled_oneshot_report_refused')
        self.passes[kind] = report

    def run_independent_snapshot(self):
        self.run_once('snapshot')

    def snapshot_pass_verified(self):
        return self.passes.get('snapshot') in ({'outcome': 'recorded'}, {'outcome': 'duplicate'})

    def run_background_once(self):
        self.run_once('background')

    def background_pass_verified(self):
        return self.passes.get('background') == {'status': 'completed'}

    def protected_payment_state_unchanged(self):
        prove_unchanged(self.payment_before, _json(database(snapshot_sql().decode()).encode()))
        return True

    def schedule_workers(self):
        verify_deadlines()
        command(['/usr/bin/systemctl', 'start', PREFIX + 'snapshot.timer', PREFIX + 'background.timer'])

    def schedules_and_deadlines_verified(self):
        verify_deadlines()
        return all(properties(PREFIX + kind + '.timer', ('ActiveState',)) == {'ActiveState': 'active'}
                   for kind in ('snapshot', 'background'))

    def public_mutations_disabled(self):
        return self.public_probe()['mutationsEnabled'] is False

    def withdraw_financial_only(self):
        return self.installation.withdraw()
