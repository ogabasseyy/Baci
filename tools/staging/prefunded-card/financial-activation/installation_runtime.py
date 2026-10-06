import json
import os
from pathlib import Path
import re
import stat
import sys
import time

from installation_contract import (KINDS, REPLAY_ROOT, WORKER_ROOT, candidate_inputs,
                                   validate_predecessor, verify_seal)
from installation_files import directory, place, tree_fingerprint
from installation_units import install_deadlines, validate_unchanged_units, verified_plan
from release_contract import _require

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from replay_cutover_runtime import (CONTAINER, IMAGE, NETWORKS,
    create_arguments as replay_arguments, validate_container as validate_replay)
from runtime_owner_support import DOCKER, command
from runtime_scheduler import (PREFIX, STATE, NETWORKS as WORKER_NETWORKS,
    create_arguments as worker_arguments, validate_container as validate_worker)
from treasury_owner_io import private_directory, root_ancestors

NAMES = {'replay': CONTAINER, 'replay-check': CONTAINER + '-check',
         **{kind: PREFIX + kind for kind in KINDS}}
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def inspect(name):
    value = json.loads(command([*DOCKER, 'inspect', name]))
    _require(isinstance(value, list) and len(value) == 1, 'installation_container_missing')
    return value[0]


def quiescent():
    from installation_units import properties
    for kind in ('snapshot', 'background'):
        row = properties(PREFIX + kind + '.timer', ('ActiveState',))
        _require(row['ActiveState'] == 'inactive', 'installation_schedule_still_active')
    for name in NAMES.values():
        _require(inspect(name)['State']['Running'] is False,
                 'installation_container_still_active')


def runner_state(path=Path(STATE)):
    root_ancestors(path)
    metadata = path.lstat()
    _require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == metadata.st_gid == 65532
             and stat.S_IMODE(metadata.st_mode) == 0o700, 'installation_runner_directory_refused')
    descriptor = os.open(path / 'runner.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        _require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == metadata.st_gid == 65532
                 and stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_nlink == 1
                 and metadata.st_size == 0, 'installation_runner_lock_refused')
    finally:
        os.close(descriptor)


class RuntimeInstallation:
    def __init__(self, bundle, seal_sha, candidate, replay_directory, private_pins, audit, *, candidate_sha):
        _require(os.geteuid() == 0 and time.time() < 1791301750,
                 'installation_root_or_window_refused')
        for path in (bundle, candidate, replay_directory, audit):
            root_ancestors(path)
            private_directory(path)
        self.bundle, self.seal_sha, self.candidate, self.audit = bundle, seal_sha, candidate, audit
        self.candidate_sha = candidate_sha
        self.seal = verify_seal(bundle, seal_sha)
        self.configs, self.replay_configs, self.workers, self.replay = candidate_inputs(
            bundle, self.seal, candidate, replay_directory, private_pins, candidate_sha)
        image = json.loads(command([*DOCKER, 'image', 'inspect', IMAGE]))[0]
        self.image_environment = image['Config']['Env']
        self.baseline = None
        self.retained = []

    def capture(self, expected_trees):
        quiescent()
        runner_state()
        containers = {kind: inspect(name) for kind, name in NAMES.items()}
        validate_predecessor(containers, self.image_environment)
        _require(set(expected_trees) == {str(WORKER_ROOT), str(REPLAY_ROOT)},
                 'installation_tree_scope_refused')
        from installation_contract import validate_tree
        trees = {root: validate_tree(Path(root), rows) for root, rows in expected_trees.items()}
        self.expected_trees = expected_trees
        self.baseline = {'containers': containers, 'trees': trees, 'observedAt': time.time()}
        return {'status': 'installation_predecessors_checked', 'changesMade': False}

    def install(self):
        _require(self.baseline is not None and 0 <= time.time() - self.baseline['observedAt'] <= 60,
                 'installation_baseline_stale')
        quiescent()
        runner_state()
        for kind, name in NAMES.items():
            _require(inspect(name) == self.baseline['containers'][kind],
                     'installation_container_changed_since_capture')
        for root, rows in self.expected_trees.items():
            _require(tree_fingerprint(Path(root), rows) == self.baseline['trees'][root],
                     'installation_tree_changed_since_capture')
        suffix = self.audit.name
        _require(re.fullmatch(r'[A-Za-z0-9.-]{1,90}', suffix) is not None,
                 'installation_audit_name_refused')
        targets = [root.with_name(root.name + '.before-' + suffix)
                   for root in (WORKER_ROOT, REPLAY_ROOT)]
        _require(all(not path.exists() and not path.is_symlink() for path in targets),
                 'installation_retained_tree_exists')
        for kind, name in NAMES.items():
            _require(not command([*DOCKER, 'ps', '-a', '--filter',
                'name=^/' + name + '-before-' + suffix + '$', '--format', '{{.ID}}']).strip(),
                'installation_retained_container_exists')
        validate_unchanged_units()
        verified_plan(self.candidate, self.candidate_sha)
        _require(time.time() < 1791301750, 'installation_window_expired')
        for name in NAMES.values():
            retained = name + '-before-' + suffix
            command([*DOCKER, 'rename', name, retained])
            self.retained.append(retained)
        for root, target in zip((WORKER_ROOT, REPLAY_ROOT), targets):
            os.rename(root, target)
            self.retained.append(str(target))
        directory(WORKER_ROOT, mode=0o755)
        directory(WORKER_ROOT / 'code', mode=0o755)
        directory(WORKER_ROOT / 'config')
        for name, content in self.workers.items():
            place(WORKER_ROOT / 'code' / name, content, mode=0o444)
        from runtime_scheduler import background_wrapper
        place(WORKER_ROOT / 'code/background.sh', background_wrapper().encode(), mode=0o444)
        for name, owner in (('background.json', 65532), ('snapshot.json', 65531)):
            place(WORKER_ROOT / 'config' / name, self.configs[name], owner=owner, group=owner)
        for root in (REPLAY_ROOT, REPLAY_ROOT / 'code', REPLAY_ROOT / 'config'):
            directory(root, group=65532, mode=0o750)
        for name, content in self.replay.items():
            place(REPLAY_ROOT / 'code' / name, content, group=65532, mode=0o644)
        for name, content in self.replay_configs.items():
            place(REPLAY_ROOT / 'config' / name, content, group=65532, mode=0o440)
        self.create_containers()
        units = self.audit / 'units-before'
        directory(units)
        timers = install_deadlines(self.candidate, units, self.candidate_sha)
        quiescent()
        return {'status': 'financial-installed-inactive', 'sealSha256': self.seal_sha,
                'retained': self.retained, 'timers': timers, 'mutationsEnabled': False}

    def create_containers(self):
        for kind in NAMES:
            if kind.startswith('replay'):
                check = kind == 'replay-check'
                arguments = replay_arguments(str(REPLAY_ROOT), self.seal_sha, check)
                networks = NETWORKS
            else:
                arguments = worker_arguments(kind, self.seal_sha)
                networks = WORKER_NETWORKS
            command([*DOCKER, *arguments])
            for network in networks[1:]:
                command([*DOCKER, 'network', 'connect', network, NAMES[kind]])
            observed = inspect(NAMES[kind])
            if kind.startswith('replay'):
                validate_replay(observed, str(REPLAY_ROOT), self.seal_sha, kind == 'replay-check')
            else:
                validate_worker(observed, kind, self.seal_sha)
            _require(observed['Config']['Env'] == self.image_environment
                     and observed['State']['Running'] is False,
                     'installation_new_container_state_or_environment_refused')

    def withdraw(self):
        command(['/usr/bin/systemctl', 'stop', PREFIX + 'snapshot.timer',
            PREFIX + 'background.timer', PREFIX + 'snapshot.service', PREFIX + 'background.service'],
            timeout=40)
        for name in NAMES.values():
            exists = command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + name + '$',
                              '--format', '{{.ID}}']).strip()
            if exists:
                command([*DOCKER, 'stop', '--time', '5', name], timeout=15)
                _require(inspect(name)['State']['Running'] is False,
                         'installation_financial_withdrawal_unconfirmed')
        return True
