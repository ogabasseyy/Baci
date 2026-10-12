import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from parser_repair_contract import (
    CONFIGURATION_DIGESTS, CONTAINERS, DIRECTORY, FACTORY_DIGEST, LABEL,
    MANIFEST_DIGEST, ORIGINAL_DIGEST, REPAIRED_DIGEST, Refused, check_parents,
    digest, provenance, read_managed, serialize, validate_replacement, write_new,
)


DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
RUN_LABEL = 'com.baci.interest-parser-repair.run'


class Repair:
    def __init__(self, bundle):
        self.bundle = bundle
        self.tag = uuid.uuid4().hex[:12]
        self.stage = 'preflight'
        self.created = {}
        self.renamed = {}
        self.changed = False

    def command(self, arguments):
        result = subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=ENVIRONMENT, timeout=30, check=False)
        if result.returncode or len(result.stdout) > 131072:
            raise Refused('Container command refused')
        return result.stdout.decode()

    def inspect(self, name):
        observed = json.loads(self.command([*DOCKER, 'inspect', name]))
        if not isinstance(observed, list) or len(observed) != 1:
            raise Refused('Container identity unavailable')
        return observed[0]

    def verify_container(self, name, expected_digest, check, expected_id=None):
        observed = self.inspect(name)
        self.runtime.validate_container(observed, str(DIRECTORY), expected_digest, check)
        state = observed['State']
        if (observed['Name'] != '/' + name or state['Running'] or state['Paused']
                or state['Restarting'] or state['Status'] not in ('created', 'exited')
                or observed['Config'].get('Env') != self.image_environment
                or (expected_digest == self.new_digest and observed['Config']['Labels'].get(RUN_LABEL) != self.tag)
                or (expected_id is not None and observed['Id'] != expected_id)):
            raise Refused('Container is active or changed')
        return observed['Id']

    def audit(self, manifest, contents):
        self.audit_directory = self.bundle / 'provenance'
        self.audit_directory.mkdir(mode=0o700)
        for name, content in contents.items():
            write_new(self.audit_directory / name,
                self.repaired if name == 'replay-daemon.mjs' else content)
        manifest = {**manifest, 'replay-daemon.mjs': REPAIRED_DIGEST}
        manifest_bytes = serialize(manifest)
        write_new(self.audit_directory / 'manifest.json', manifest_bytes)
        write_new(self.bundle / 'replay-daemon.before.mjs', self.original)
        self.new_digest = digest(manifest_bytes)
        sys.path.insert(0, str(self.audit_directory))
        spec = importlib.util.spec_from_file_location('reviewed_replay_runtime',
            self.audit_directory / 'replay_cutover_runtime.py')
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)

    def protected_files(self, expected_daemon):
        read_managed(DIRECTORY / 'code' / 'replay-daemon.mjs', 65532, 0o644, expected_daemon)
        read_managed(DIRECTORY / 'code' / 'prefunded-replay-bundle.mjs', 65532, 0o644, FACTORY_DIGEST)
        for name, expected in CONFIGURATION_DIGESTS.items():
            read_managed(DIRECTORY / 'config' / name, 65532, 0o440, expected)

    def preflight(self):
        if os.geteuid() != 0:
            raise Refused('Owner access required')
        check_parents(self.bundle / 'parser_repair_owner.py')
        manifest, contents = provenance()
        self.original = read_managed(DIRECTORY / 'code' / 'replay-daemon.mjs', 65532, 0o644, ORIGINAL_DIGEST)
        self.repaired = read_managed(self.bundle / 'replay-daemon.mjs', expected=REPAIRED_DIGEST)
        read_managed(self.bundle / 'prefunded-replay-bundle.mjs', expected=FACTORY_DIGEST)
        validate_replacement(self.original, self.repaired)
        self.protected_files(ORIGINAL_DIGEST)
        self.audit(manifest, contents)
        self.image_environment = json.loads(self.command([*DOCKER, 'image', 'inspect', self.runtime.IMAGE]))[0]['Config'].get('Env')
        self.original_ids = {
            name: self.verify_container(name, MANIFEST_DIGEST, position == 1)
            for position, name in enumerate(CONTAINERS)
        }

    def create_candidates(self):
        self.stage = 'inactive-container-preparation'
        for position, name in enumerate(CONTAINERS):
            candidate = name + '-parser-next-' + self.tag
            if self.command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + candidate + '$', '--format', '{{.ID}}']).strip():
                raise Refused('Candidate name already exists')
            arguments = self.runtime.create_arguments(str(DIRECTORY), self.new_digest, position == 1)
            arguments = ['--name=' + candidate if value.startswith('--name=') else value for value in arguments]
            arguments.insert(1, '--label=' + RUN_LABEL + '=' + self.tag)
            self.created[candidate] = None
            identifier = self.command([*DOCKER, *arguments]).strip()
            if not re.fullmatch('[a-f0-9]{64}', identifier):
                raise Refused('Candidate identity unavailable')
            self.created[candidate] = identifier
            for network in self.runtime.NETWORKS[1:]:
                self.command([*DOCKER, 'network', 'connect', network, candidate])
            self.verify_container(candidate, self.new_digest, position == 1, identifier)

    def swap(self, content, expected):
        target = DIRECTORY / 'code' / 'replay-daemon.mjs'
        read_managed(target, 65532, 0o644, expected)
        temporary = target.with_name('.replay-daemon.' + self.tag + '.mjs')
        write_new(temporary, content, 65532, 0o644)
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def current_digest(self):
        return digest(read_managed(DIRECTORY / 'code' / 'replay-daemon.mjs', 65532, 0o644))

    def install(self):
        self.stage = 'parser-only-installation'
        self.protected_files(ORIGINAL_DIGEST)
        for position, name in enumerate(CONTAINERS):
            self.verify_container(name, MANIFEST_DIGEST, position == 1, self.original_ids[name])
        self.changed = True
        self.swap(self.repaired, ORIGINAL_DIGEST)
        for position, name in enumerate(CONTAINERS):
            backup = name + '-parser-before-' + self.tag
            self.renamed[name] = backup
            self.command([*DOCKER, 'rename', name, backup])
            candidate = name + '-parser-next-' + self.tag
            self.command([*DOCKER, 'rename', candidate, name])
            self.verify_container(name, self.new_digest, position == 1, self.created[candidate])
        self.stage = 'installed-inactive-verification'
        self.protected_files(REPAIRED_DIGEST)

    def candidate_present(self, identifier):
        observed = self.command([*DOCKER, 'ps', '-a', '--no-trunc', '--filter',
            'id=' + identifier, '--format', '{{.ID}}']).strip()
        if observed not in ('', identifier):
            raise Refused('Rollback candidate identity differs')
        return bool(observed)

    def rollback(self):
        for candidate, identifier in reversed(tuple(self.created.items())):
            if identifier is None:
                identifier = self.command([*DOCKER, 'ps', '-a', '--no-trunc', '--filter', 'name=^/' + candidate + '$', '--format', '{{.ID}}']).strip()
                if not identifier:
                    continue
                if not re.fullmatch('[a-f0-9]{64}', identifier):
                    raise Refused('Rollback candidate identity unavailable')
            if not self.candidate_present(identifier):
                continue
            observed = self.inspect(identifier)
            current_name = observed['Name'].lstrip('/')
            state = observed['State']
            position = next(index for index, name in enumerate(CONTAINERS) if candidate.startswith(name + '-parser-next-'))
            networks = set(observed['NetworkSettings']['Networks'])
            if (observed['Id'] != identifier or state['Running'] or state['Paused'] or state['Restarting']
                    or observed['Config'].get('Env') != self.image_environment
                    or observed['Config']['Labels'].get(RUN_LABEL) != self.tag
                    or self.runtime.NETWORKS[0] not in networks or not networks.issubset(self.runtime.NETWORKS)
                    or current_name not in (*CONTAINERS, candidate)):
                raise Refused('Rollback container changed')
            validation_view = copy.deepcopy(observed)
            validation_view['NetworkSettings']['Networks'] = {network: {} for network in self.runtime.NETWORKS}
            self.runtime.validate_container(validation_view, str(DIRECTORY), self.new_digest, position == 1)
            try:
                self.command([*DOCKER, 'rm', identifier])
            except Exception:
                if self.candidate_present(identifier):
                    raise
            else:
                if self.candidate_present(identifier):
                    raise Refused('Rollback candidate removal unconfirmed')
        for name, backup in reversed(tuple(self.renamed.items())):
            identifier = self.original_ids[name]
            observed = self.inspect(identifier)
            if (observed['Id'] != identifier or observed['State']['Running']
                    or observed['Name'] not in ('/' + name, '/' + backup)):
                raise Refused('Rollback baseline changed')
            if observed['Name'] != '/' + name:
                self.command([*DOCKER, 'rename', identifier, name])
        if self.changed:
            current = self.current_digest()
            if current == REPAIRED_DIGEST:
                self.swap(self.original, REPAIRED_DIGEST)
            elif current != ORIGINAL_DIGEST:
                raise Refused('Rollback artifact changed')
        if hasattr(self, 'original_ids'):
            self.protected_files(ORIGINAL_DIGEST)
            for position, name in enumerate(CONTAINERS):
                self.verify_container(name, MANIFEST_DIGEST, position == 1, self.original_ids[name])

    def record(self):
        report = dict(status='interest-parser-installed-inactive',
            previousManifestSha256=MANIFEST_DIGEST, manifestSha256=self.new_digest,
            originalDaemonSha256=ORIGINAL_DIGEST, daemonSha256=REPAIRED_DIGEST,
            servicesStarted=False, financialRenewalApplied=False, financialDeadline='2026-09-29T15:59:10Z',
            walletInterestChanged=False, balancesChanged=False, protectedConfigurationUnchanged=True,
            preservedContainers=self.renamed, provenanceDirectory=str(self.audit_directory))
        write_new(self.bundle / 'installation-result.json', serialize(report))
        return report

    def record_refusal(self, error, cleanup_error, cleanup_succeeded):
        report = dict(status='refused', stage=self.stage, redacted=True,
            cleanupSucceeded=cleanup_succeeded, servicesStarted=False, financialRenewalApplied=False,
            exceptionClass=type(error).__name__,
            rollbackExceptionClass=type(cleanup_error).__name__ if cleanup_error is not None else None,
            preservedContainers=self.renamed, candidateContainers=self.created)
        write_new(self.bundle / 'refusal-result.json', serialize(report))

    def run(self):
        self.preflight()
        self.create_candidates()
        self.install()
        return self.record()


if __name__ == '__main__':
    repair = Repair(Path(sys.argv[1]))
    try:
        report = repair.run()
    except Exception as error:
        cleanup_succeeded = False
        cleanup_error = None
        try:
            repair.rollback()
            cleanup_succeeded = True
        except Exception as rollback_error:
            cleanup_error = rollback_error
        refusal_record_saved = False
        try:
            repair.record_refusal(error, cleanup_error, cleanup_succeeded)
            refusal_record_saved = True
        except Exception:
            refusal_record_saved = False
        print(json.dumps(dict(status='refused', stage=repair.stage, redacted=True,
            cleanupSucceeded=cleanup_succeeded, refusalRecordSaved=refusal_record_saved,
            servicesStarted=False, financialRenewalApplied=False)))
        raise SystemExit(1)
    print(json.dumps(report, separators=(',', ':')))
