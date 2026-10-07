import importlib
import json
from pathlib import Path
import re
import sys

from owner_io import Refused, require


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'runtime' if (HERE.parent / 'runtime').is_dir() else HERE.parent))
runtime = importlib.import_module('replay_cutover_runtime')
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']


class DockerRuntime:
    def __init__(self, run, deadline):
        self.run = run
        self.deadline = deadline
        image = json.loads(run([*DOCKER, 'image', 'inspect', runtime.IMAGE]))
        require(len(image) == 1 and image[0]['Id'] == runtime.IMAGE, 'image_identity_refused')
        self.environment = image[0]['Config']['Env']

    def find(self, name):
        require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,100}', name) is not None, 'container_name_refused')
        rows = self.run([*DOCKER, 'container', 'ls', '--all', '--no-trunc',
                         '--filter=name=^/' + name + '$', '--format={{.ID}}']).strip().splitlines()
        require(len(rows) <= 1 and all(re.fullmatch('[a-f0-9]{64}', row) for row in rows),
                'container_lookup_refused')
        return rows[0] if rows else None

    def inspect(self, identifier, directory, label, check=False, name=None):
        require(re.fullmatch('[a-f0-9]{64}', identifier or '') is not None, 'container_id_refused')
        rows = json.loads(self.run([*DOCKER, 'inspect', identifier]))
        require(len(rows) == 1 and rows[0]['Id'] == identifier, 'container_identity_refused')
        value = rows[0]
        runtime.validate_container(value, directory, label, check)
        require(value['Config'].get('Env') == self.environment
                and value['HostConfig'].get('NetworkMode') == runtime.NETWORKS[0]
                and (name is None or value['Name'] == '/' + name), 'container_environment_or_name_refused')
        return value

    def create(self, directory, label, check=False, name=None):
        name = name or runtime.CONTAINER
        require(self.find(name) is None, 'container_name_already_present')
        arguments = runtime.create_arguments(directory, label, check)
        arguments = ['--name=' + name if value.startswith('--name=') else value for value in arguments]
        identifier = self.run([*DOCKER, *arguments]).strip()
        require(re.fullmatch('[a-f0-9]{64}', identifier) is not None, 'created_container_id_refused')
        for network in runtime.NETWORKS[1:]:
            self.run([*DOCKER, 'network', 'connect', network, identifier])
        self.inspect(identifier, directory, label, check, name)
        return identifier

    def start_bounded(self, identifier, directory, label, check=False, name=None):
        self.deadline()
        self.run([*DOCKER, 'start', identifier])
        try:
            self.deadline()
            self.inspect(identifier, directory, label, check, name)
            self.deadline()
        except Exception:
            observed = self.inspect(identifier, directory, label, check, name)
            if observed['State']['Running']:
                self.run([*DOCKER, 'stop', '--time=45', identifier], timeout=60)
            observed = self.inspect(identifier, directory, label, check, name)
            require(observed['State']['Running'] is False, 'expired_start_not_stopped')
            raise Refused('expired_or_invalid_start_stopped') from None

    def check(self, directory, label):
        self.deadline()
        name = runtime.CONTAINER + '-native-check-' + label[:12]
        identifier = self.create(directory, label, True, name)
        try:
            self.start_bounded(identifier, directory, label, True, name)
            require(self.run([*DOCKER, 'wait', identifier], timeout=45).strip() == '0', 'readiness_exit_refused')
            observed = self.inspect(identifier, directory, label, True, name)
            require(observed['State']['Running'] is False and observed['State']['ExitCode'] == 0
                    and not observed['State'].get('OOMKilled'), 'readiness_state_refused')
            report = json.loads(self.run([*DOCKER, 'logs', '--tail=4', identifier]))
            require(report == {'status': 'replay-runtime-ready', 'readOnly': True}, 'readiness_report_refused')
            self.deadline()
        except Exception:
            observed = self.inspect(identifier, directory, label, True, name)
            if observed['State']['Running']:
                self.run([*DOCKER, 'stop', '--time=45', identifier], timeout=60)
            observed = self.inspect(identifier, directory, label, True, name)
            require(observed['State']['Running'] is False, 'readiness_cleanup_refused')
            self.run([*DOCKER, 'rm', identifier])
            raise Refused('read_only_check_refused') from None
        self.run([*DOCKER, 'rm', identifier])

    def restore(self, old_id, retained, old_directory, old_label, new_id, new_directory, new_label, was_running):
        if new_id is not None:
            current = self.inspect(new_id, new_directory, new_label, name=runtime.CONTAINER)
            if current['State']['Running']:
                self.run([*DOCKER, 'stop', '--time=45', new_id], timeout=60)
            current = self.inspect(new_id, new_directory, new_label, name=runtime.CONTAINER)
            require(current['State']['Running'] is False, 'replacement_not_stopped')
            failed = runtime.CONTAINER + '-failed-' + new_id[:12]
            require(self.find(failed) is None, 'failed_retention_name_present')
            self.run([*DOCKER, 'rename', new_id, failed])
        require(self.find(runtime.CONTAINER) is None, 'restore_name_occupied')
        original = self.inspect(old_id, old_directory, old_label, name=retained)
        require(original['State']['Running'] is False, 'retained_original_not_stopped')
        self.deadline()
        self.run([*DOCKER, 'rename', old_id, runtime.CONTAINER])
        if was_running:
            self.start_bounded(old_id, old_directory, old_label, name=runtime.CONTAINER)
        restored = self.inspect(old_id, old_directory, old_label, name=runtime.CONTAINER)
        require(restored['State']['Running'] is was_running, 'original_restore_state_refused')

    def swap(self, old_directory, old_label, new_directory, new_label, verify_predecessor, expected_original=None):
        self.deadline()
        verify_predecessor()
        self.deadline()
        old_id = self.find(runtime.CONTAINER)
        original = self.inspect(old_id, old_directory, old_label, name=runtime.CONTAINER)
        was_running = original['State']['Running']
        require(type(was_running) is bool and (expected_original is None or
                expected_original == (old_id, was_running)), 'original_observed_state_changed')
        retained = runtime.CONTAINER + '-prior-' + old_id[:12]
        require(self.find(retained) is None, 'original_retention_name_present')
        if was_running:
            self.run([*DOCKER, 'stop', '--time=45', old_id], timeout=60)
        original = self.inspect(old_id, old_directory, old_label, name=runtime.CONTAINER)
        require(original['State']['Running'] is False and (not was_running or original['State']['ExitCode'] == 0)
                and not original['State'].get('OOMKilled'), 'original_not_gracefully_quiesced')
        self.deadline()
        verify_predecessor()
        self.deadline()
        self.run([*DOCKER, 'rename', old_id, retained])
        new_id = None
        try:
            new_id = self.create(new_directory, new_label)
            self.deadline()
            verify_predecessor()
            self.deadline()
            if was_running:
                self.start_bounded(new_id, new_directory, new_label, name=runtime.CONTAINER)
            current = self.inspect(new_id, new_directory, new_label, name=runtime.CONTAINER)
            require(current['State']['Running'] is was_running, 'replacement_observed_state_changed')
            self.deadline()
            return {'originalContainerId': old_id, 'retainedOriginalName': retained, 'replacementContainerId': new_id}
        except Exception:
            try:
                observed_id = self.find(runtime.CONTAINER)
                require(new_id is None or observed_id == new_id, 'replacement_identity_changed')
                self.restore(old_id, retained, old_directory, old_label, observed_id,
                             new_directory, new_label, was_running)
            except Exception:
                raise Refused('manual_recovery_required_original_retained') from None
            raise Refused('upgrade_failed_original_restored') from None
