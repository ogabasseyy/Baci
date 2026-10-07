from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import time

from mutation_contract import AUDIT, EPOCH, FINANCIAL_SEAL, FLAG, MANIFEST, financial_report, window
from mutation_chain import sql as chain_sql, validate as validate_chain
from mutation_runtime import active_runtime, collect as runtime_evidence, wait_public
from mutation_runtime_bounds import RuntimeBounds
from installation_contract import verify_seal
from owner_database import renewal_proof
import owner_public
import owner_public_artifacts
from protected_snapshot import prove_unchanged, snapshot_sql
from readiness_evidence_io import pinned, root_request
from release_contract import DEADLINE, HEX, digest, _require
from runtime_owner_support import DOCKER, command, database
import public_service_contract as service
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


def _environment(entries):
    _require(isinstance(entries, list) and all(isinstance(entry, str) and '=' in entry
             for entry in entries), 'public_mutation_environment_shape_refused')
    values = {}
    for entry in entries:
        name, value = entry.split('=', 1)
        _require(name and name not in values, 'public_mutation_environment_duplicate_or_empty_key')
        values[name] = value
    return values


class PublicMutationOwner:
    def __init__(self, request_path, request_sha, now=time.time, recovery_only=False):
        if not recovery_only:
            window(now())
        self.recovery_only = recovery_only
        self.request_sha = request_sha
        self.now = now
        self.request = root_request(Path(request_path), request_sha)
        self.seal_sha = self.request['financialSealSha256']
        _require(self.seal_sha == FINANCIAL_SEAL, 'public_mutation_r8_financial_seal_required')
        self.bundle = Path(self.request['financialBundle'])
        self.audit = Path(self.request['audit'])
        root_ancestors(self.audit)
        private_directory(self.audit)
        _require(self.audit.parent == Path('/root') and self.audit.name.startswith('baci-public-mutation.'),
                 'public_mutation_audit_scope_refused')
        self.deadline = DEADLINE
        self.retained = service.NAME + '-before-' + self.audit.name
        _require(len(self.retained) < 160 and all(character.isalnum() or character in '.-'
                 for character in self.retained), 'public_mutation_retained_name_refused')
        self.old_id = None
        self.new_id = None
        self.renamed = False

    @contextmanager
    def lock(self):
        descriptor = os.open('/run/lock/baci-public-readonly.lock',
            os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            metadata = os.fstat(descriptor)
            import stat
            _require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0
                and metadata.st_nlink == 1 and stat.S_IMODE(metadata.st_mode) == 0o600,
                'public_mutation_lock_metadata_refused')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(descriptor)

    def private_input(self, key):
        record = self.request[key]
        _require(Path(record['path']).parent == Path(AUDIT), 'public_mutation_owner_evidence_scope_refused')
        return json.loads(pinned(record, private=True))

    def verify_reviewed_inputs(self):
        _require(not self.recovery_only, 'public_mutation_recovery_cannot_enable')
        window(self.now())
        _require(self.seal_sha == FINANCIAL_SEAL, 'public_mutation_r8_financial_seal_required')
        self.seal = verify_seal(self.bundle, self.seal_sha)
        self.bounds = RuntimeBounds(self.bundle, self.seal, self.seal_sha)
        self.source_provenance = self.bounds.verify_sources()
        self.report = self.private_input('financialReport')
        financial_report(self.report)
        self.baseline = self.private_input('protectedBaseline')
        prove_unchanged(self.baseline, self.baseline)
        self.chain_baseline = self.private_input('chainBaseline')
        self.chain_sha = validate_chain(self.chain_baseline)
        self.runtime_request = root_request(Path(self.request['runtimeRequest']['path']),
                                           self.request['runtimeRequest']['sha256'])
        _require(self.runtime_request['seal']['sha256'] == self.seal_sha,
                 'public_mutation_runtime_request_seal_refused')
        for name, expected in self.request['reviewedSidecarSha256'].items():
            _require(name in ('mutation_contract.py', 'mutation_chain.py', 'mutation_runtime.py',
                'mutation_gate.py', 'mutation_owner.py', 'systemd_deadline_reader.py',
                'mutation_runtime_bounds.py', 'README.md'),
                'public_mutation_source_scope_refused')
            _require(digest((Path(__file__).parent / name).read_bytes()) == expected,
                     'public_mutation_reviewed_source_drift')
        _require(set(self.request['reviewedSidecarSha256']) == {'mutation_contract.py',
            'mutation_chain.py', 'mutation_runtime.py', 'mutation_gate.py', 'mutation_owner.py',
            'systemd_deadline_reader.py', 'mutation_runtime_bounds.py', 'README.md'},
            'public_mutation_reviewed_source_incomplete')
        _require(not (self.audit / 'enable-intent.json').exists(), 'public_mutation_prior_attempt_requires_recovery')
        _require(not command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + self.retained + '$',
            '--format', '{{.ID}}']).strip(), 'public_mutation_retained_container_exists')

    def snapshot(self):
        return json.loads(database(snapshot_sql().decode()))

    def recheck_chain(self):
        current = json.loads(database(chain_sql()))
        _require(validate_chain(current) == self.chain_sha,
                 'public_mutation_approved_full_chain_changed')
        renewal_proof(Path(AUDIT))

    def inspect(self, name=service.NAME, run=None):
        run = command if run is None else run
        rows = json.loads(run([*DOCKER, 'inspect', name]))
        _require(len(rows) == 1 and len(rows[0]['Id']) == 64, 'public_mutation_container_identity_refused')
        return rows[0]

    def verify_public(self, enabled, expected_id=None, run=None):
        run = command if run is None else run
        self.verify_public_unit(run=run)
        observed = self.inspect(run=run)
        _require(expected_id is None or observed['Id'] == expected_id,
                 'public_mutation_startup_identity_changed')
        image = json.loads(run([*DOCKER, 'image', 'inspect', service.IMAGE]))[0]
        inherited = _environment(image['Config']['Env'])
        _require(image['Id'] == service.IMAGE and FLAG not in inherited,
            'public_mutation_image_environment_refused')
        expected_env = {**inherited, **({FLAG: 'true'} if enabled else {})}
        _require(_environment(observed['Config']['Env']) == expected_env, 'public_mutation_exact_flag_required')
        normalized = copy.deepcopy(observed)
        normalized['Config']['Env'] = image['Config']['Env']
        service.validate_container(normalized, MANIFEST, image['Config']['Env'])
        _require(observed['State']['Running'] is True, 'public_mutation_public_not_running')

        def artifact_run(arguments):
            if arguments == [*DOCKER, 'inspect', service.NAME]:
                return json.dumps([normalized])
            return run(arguments)

        owner_public_artifacts.verify(self.bundle, run=artifact_run)
        return observed

    def verify_public_unit(self, run=None):
        run = command if run is None else run
        record = self.request['publicService']
        name = service.NAME + '.service'
        _require(record['path'] == '/etc/systemd/system/' + name
            and record['owner'] == 0 and record['mode'] == 0o644,
            'public_mutation_public_unit_path_refused')
        content = pinned(record).decode()
        condition = '/bin/sh -c \'test "$(/bin/date -u +%%s)" -lt "1791302350"\''
        start = ' '.join([*DOCKER, 'start', '--attach', service.NAME])
        _require(re.findall(r'^ExecCondition=(.*)$', content, re.MULTILINE) == [condition]
            and re.findall(r'^ExecStart=(.*)$', content, re.MULTILINE) == [start]
            and not re.search(r'^(Environment|EnvironmentFile|ExecStartPre|ExecStartPost)=',
                              content, re.MULTILINE), 'public_mutation_public_unit_scope_refused')
        from readiness_evidence_timers import properties
        observed = run(['/usr/bin/systemctl', 'show', name,
            '--property=FragmentPath,DropInPaths,NeedDaemonReload,LoadState,ActiveState'])
        _require(properties(observed) == {'FragmentPath': record['path'], 'DropInPaths': '',
            'NeedDaemonReload': 'no', 'LoadState': 'loaded', 'ActiveState': 'active'},
            'public_mutation_public_unit_not_effective')

    def private_launch(self):
        return json.loads(command([*DOCKER, 'exec', '--user=65530:65530', service.NAME,
            '/usr/local/bin/node', '/app/launch-public.cjs', '--check']))

    def collect(self):
        started = self.now()
        before = self.snapshot()
        self.recheck_chain()
        self.verify_public(False)
        public = owner_public.verify(artifacts=lambda: owner_public_artifacts.verify(self.bundle))
        runtime, restricted = runtime_evidence(self.runtime_request, self.seal, self.seal_sha,
                                               now=self.now, bounds=self.bounds)
        private = self.private_launch()
        after = self.snapshot()
        _require(0 <= self.now() - started <= 60, 'public_mutation_collection_stale')
        return {'sealSha256': self.seal_sha, 'sourceProvenance': self.source_provenance,
            'observedAt': datetime.fromtimestamp(
            self.now(), timezone.utc).isoformat(), 'financialReport': self.report,
            'public': public, 'runtime': runtime, 'restricted': restricted,
            'publicPrivate': private, 'chainSha256': self.chain_sha,
            'approvedChainSha256': self.chain_sha, 'protectedBefore': before, 'protectedAfter': after}

    def recheck(self, evidence):
        self.verify_reviewed_inputs()
        self.recheck_chain()
        prove_unchanged(evidence['protectedAfter'], self.snapshot())
        active_runtime(self.seal_sha, now=self.now, bounds=self.bounds)
        self.verify_public(False)

    def record(self, name, value):
        _require(name in ('preflight', 'enable-intent', 'enabled', 'recovery'), 'public_mutation_journal_scope')
        write_private(self.audit / (name + '.json'), json.dumps(value, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode())

    def transition(self):
        self.old_id = self.verify_public(False)['Id']
        return {'status': 'enable-attempt-pending', 'predecessorId': self.old_id,
            'retainedName': self.retained, 'financialSealSha256': self.seal_sha,
            'requestSha256': self.request_sha, 'deadline': DEADLINE,
            'mutationsEnabled': 'unknown-until-readback'}

    def replace_public(self):
        _require(self.old_id == self.verify_public(False)['Id'], 'public_mutation_predecessor_changed')
        command(['/usr/bin/systemctl', 'stop', service.NAME + '.service'])
        _require(self.inspect()['Id'] == self.old_id and self.inspect()['State']['Running'] is False,
                 'public_mutation_predecessor_not_stopped')
        command([*DOCKER, 'rename', self.old_id, self.retained])
        self.renamed = True
        window(self.now())
        arguments = service.create_arguments(MANIFEST)
        arguments.insert(1, '--env=' + FLAG + '=true')
        command([*DOCKER, *arguments])
        self.new_id = self.inspect()['Id']
        command([*DOCKER, 'network', 'connect', service.NETWORKS[1], self.new_id])
        window(self.now())
        command(['/usr/bin/systemctl', 'start', service.NAME + '.service'])
        wait_public(lambda run: self.verify_public(True, self.new_id, run=run), command, self.now)

    def verify_enabled(self):
        self.verify_public(True)
        _require(self.private_launch() == {'status': 'public-private-ready',
            'customerTlsVerified': True, 'verifierTlsVerified': True, 'httpStarted': False},
            'public_mutation_enabled_private_check_refused')
        runtime_evidence(self.runtime_request, self.seal, self.seal_sha,
                        now=self.now, bounds=self.bounds)

    def capability(self):
        headers = owner_public.authenticate(read=owner_public.root_fixture)
        return owner_public.request('GET', owner_public.PATH + '?goalId=' + owner_public.GOAL, headers)

    def recover(self):
        command(['/usr/bin/systemctl', 'stop', service.NAME + '.service'])
        retained = command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + self.retained + '$',
                            '--format', '{{.ID}}']).strip()
        self.renamed = bool(retained)
        if self.renamed:
            names = command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + service.NAME + '$',
                             '--format', '{{.ID}}']).strip()
            if names:
                candidate = self.inspect()
                normalized = copy.deepcopy(candidate)
                image = json.loads(command([*DOCKER, 'image', 'inspect', service.IMAGE]))[0]
                inherited = _environment(image['Config']['Env'])
                _require(image['Id'] == service.IMAGE and FLAG not in inherited,
                         'public_mutation_image_environment_refused')
                _require(_environment(candidate['Config']['Env']) == {**inherited, FLAG: 'true'},
                         'public_mutation_recovery_candidate_flag_refused')
                normalized['Config']['Env'] = image['Config']['Env']
                if set(normalized['NetworkSettings']['Networks']) == {service.NETWORKS[0]}:
                    normalized['NetworkSettings']['Networks'][service.NETWORKS[1]] = {}
                service.validate_container(normalized, MANIFEST, image['Config']['Env'])
                _require(candidate['Image'] == service.IMAGE
                    and candidate['Config']['Labels'].get(service.LABEL) == MANIFEST
                    and candidate['Id'] != self.old_id, 'public_mutation_recovery_candidate_identity_refused')
                command([*DOCKER, 'rm', '--force', candidate['Id']])
            old = self.inspect(self.retained)
            _require(old['Id'] == self.old_id and old['State']['Running'] is False,
                     'public_mutation_recovery_predecessor_identity_refused')
            command([*DOCKER, 'rename', self.old_id, service.NAME])
        _require(self.inspect()['Id'] == self.old_id and self.inspect()['State']['Running'] is False,
                 'public_mutation_recovery_stop_unconfirmed')
        if self.now() >= EPOCH - 600:
            return {'status': 'public-stopped-deadline-expired', 'mutationsEnabled': False,
                    'httpVerified': False, 'paymentState': 'requires-independent-readback'}
        command(['/usr/bin/systemctl', 'start', service.NAME + '.service'])
        wait_public(lambda run: self.verify_public(False, self.old_id, run=run), command, self.now)
        owner_public.verify(artifacts=lambda: owner_public_artifacts.verify(self.bundle))
        return {'status': 'public-readonly-restored', 'mutationsEnabled': False,
                'paymentState': 'requires-independent-readback'}

    def recover_interrupted(self):
        with self.lock():
            journal = json.loads(read_file(self.audit / 'enable-intent.json', 0, 0o600, 32768))
            _require(journal.get('requestSha256') == self.request_sha
                and journal.get('retainedName') == self.retained
                and journal.get('financialSealSha256') == self.seal_sha
                and journal.get('deadline') == DEADLINE
                and isinstance(journal.get('predecessorId'), str)
                and HEX.fullmatch(journal['predecessorId']), 'public_mutation_recovery_journal_refused')
            self.old_id = journal['predecessorId']
            return self.recover()
