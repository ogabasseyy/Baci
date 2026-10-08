import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / 'contracts'))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / 'card-week-renewal'))
from source_functions import Refused, _require
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private

DEADLINE = '2026-10-06T15:59:10Z'
EPOCH = 1791302350
HEX = re.compile(r'^[a-f0-9]{64}$')
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
ENV = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}


def require(value, reason):
    _require(value, 'readiness_evidence_' + reason)


def window(now=None):
    value = time.time() if now is None else now
    require(value < EPOCH - 600, 'window_expired')
    return value


def digest(content):
    return hashlib.sha256(content).hexdigest()


def decode(content):
    try:
        value = json.loads(content)
        require(isinstance(value, dict), 'json_refused')
        return value
    except (ValueError, TypeError):
        raise Refused('readiness_evidence_json_refused') from None


def pinned(record, private=False):
    require(isinstance(record, dict) and set(record) == {'path', 'sha256', 'owner', 'mode'},
            'artifact_record_refused')
    path = Path(record['path'])
    require(path.is_absolute() and '..' not in path.parts and HEX.fullmatch(record['sha256']),
            'artifact_path_or_pin_refused')
    require(type(record['owner']) is int and record['owner'] in (0, 65531, 65532)
            and type(record['mode']) is int and record['mode'] in (0o400, 0o440, 0o444, 0o600, 0o644),
            'artifact_metadata_refused')
    if record['mode'] == 0o440:
        require(record['owner'] == 0 and str(path) in (
            '/opt/baci-prefunded-replay/config/config.json', '/opt/baci-prefunded-replay/config/prefunded.json')
            and path.lstat().st_gid == 65532, 'replay_group_metadata_refused')
    root_ancestors(path)
    if private:
        require(record['owner'] == 0 and record['mode'] == 0o600, 'private_metadata_refused')
        private_directory(path.parent)
    content = read_file(path, record['owner'], record['mode'], 16_000_000)
    require(digest(content) == record['sha256'], 'artifact_pin_mismatch')
    if record['mode'] == 0o440:
        require(path.lstat().st_gid == 65532, 'replay_group_metadata_refused')
    return content


def command(arguments, input_text=None, extra_env=None, timeout=35):
    window()
    try:
        result = subprocess.run(arguments, input=input_text, text=True, capture_output=True,
            stdin=subprocess.DEVNULL if input_text is None else None, timeout=timeout,
            env={**ENV, **(extra_env or {})})
        require(result.returncode == 0 and len(result.stdout) <= 1_000_000,
                'command_refused')
        window()
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        raise Refused('readiness_evidence_command_unavailable') from None


def inspection(name, run=command):
    try:
        rows = json.loads(run([*DOCKER, 'inspect', name]))
        require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
                'container_inspection_refused')
        return rows[0]
    except (ValueError, TypeError):
        raise Refused('readiness_evidence_container_inspection_refused') from None


def root_request(path, expected):
    require(os.geteuid() == 0, 'root_required')
    return decode(pinned({'path': str(path), 'sha256': expected, 'owner': 0, 'mode': 0o600}, True))


def check_output(path):
    root_ancestors(path)
    private_directory(path.parent)
    require(not path.exists() and not path.is_symlink(), 'output_exists')


def save(path, report):
    check_output(path)
    content = json.dumps(report, sort_keys=True, separators=(',', ':')).encode()
    write_private(path, content)
    return digest(content)
