"""Root read-only collection, not activation approval or a worker executor.

Parent supplies its already verified context. load_scheduler(path, source_pins)
must load only the original sealed two-file import closure, verifying those
hashes and import origins before execution without extending any allowlist.
Private bytes remain local; returned scheduler is for parent adapter construction.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat

from cutover_context import verify_financial_closure
import worker_source_authority as authority


FINANCE = Path('/root/baci-financial-owner.2ynkl9kc')
BUNDLE = FINANCE / 'bundle-r8'
MANIFEST = BUNDLE / 'financial-preparation.json'
ORIGINAL = FINANCE / 'captured/activation.prepared.json'
CANDIDATE = FINANCE / 'renewal-candidate/candidate.json'
CANDIDATE_CONFIGURATION = FINANCE / 'renewal-candidate/artifacts/workers/background.json'
SCHEDULER = BUNDLE / 'tooling/runtime_scheduler.py'
DEPENDENCY = BUNDLE / 'tooling/treasury_owner_contract.py'
WRAPPER = BUNDLE / 'tooling/background-runner.sh'
DEPENDENCY_SHA256 = 'ddc7796625f9b421d7c01266e1914607d69e849b3f2da874426492e467a94642'
UNIT_SHA256 = '68caeffd56cf1706bfc8b6cd77c6ecbaf3f064c15e851400e6e7f7d91fd1c6aa'
DOCKER = ('/usr/bin/docker', '--host=unix:///var/run/docker.sock')
PROPERTIES = ('FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState', 'ActiveState',
              'SubState', 'Result', 'ExecMainStatus', 'InvocationID')
STAT_FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
               'st_size', 'st_mtime_ns', 'st_ctime_ns')


def _require(condition):
    if not condition:
        raise ValueError('worker_owner_refused')


def _digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _lstat(path):
    return Path(path).lstat()


def _fingerprint(info):
    values = tuple(getattr(info, name) for name in STAT_FIELDS)
    _require(all(type(value) is int for value in values))
    return values


def _remember(seen, path, info):
    value = _fingerprint(info)
    _require(path not in seen or seen[path] == value)
    seen[path] = value


def _file_info(metadata, path, mode, uid, limit):
    info = metadata(path)
    _fingerprint(info)
    _require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == uid
             and stat.S_IMODE(info.st_mode) == mode and info.st_nlink == 1
             and 0 < info.st_size <= limit)
    return info


def _read(context, metadata, seen, path, pin, mode, uid=0, limit=16_000_000):
    _require(authority._pin(pin))
    for parent in reversed(path.parents):
        info = metadata(parent)
        _fingerprint(info)
        _require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
                 and not stat.S_IMODE(info.st_mode) & 0o7022)
        _remember(seen, parent, info)
    before = _file_info(metadata, path, mode, uid, limit)
    fingerprint = _fingerprint(before)
    _remember(seen, path, before)
    raw = context.owner.read(path, pin, modes=(mode,), uid=uid)
    after = _file_info(metadata, path, mode, uid, limit)
    _require(fingerprint == _fingerprint(after) and type(raw) is bytes
             and len(raw) == fingerprint[6] and _digest(raw) == pin)
    return raw, dict(sha256=pin, uid=uid, gid=uid, mode=mode, nlink=1, regularFile=True)


def _inspect(run, arguments):
    raw = run(arguments)
    _require(type(raw) is str and 0 < len(raw) <= 1_000_000)
    values = json.loads(raw)
    _require(type(values) is list and len(values) == 1 and type(values[0]) is dict)
    return values[0]


def _facts(run):
    container = _inspect(run, [*DOCKER, 'inspect', authority.BACKGROUND_CONTAINER_ID])
    image = _inspect(run, [*DOCKER, 'image', 'inspect', authority.IMAGE])
    raw = run(['/usr/bin/systemctl', 'show', 'baci-prefunded-background.service',
               *['--property=' + name for name in PROPERTIES]])
    _require(type(raw) is str and 0 < len(raw) <= 8192)
    unit = {}
    for line in raw.splitlines():
        _require('=' in line)
        name, value = line.split('=', 1)
        _require(name in PROPERTIES and name not in unit)
        unit[name] = value
    _require(set(unit) == set(PROPERTIES))
    return dict(container=container, image=image, unit=unit)


def collect_worker_authority(context, *, load_scheduler, metadata=_lstat):
    try:
        _require(os.geteuid() == 0 and callable(metadata) and callable(load_scheduler))
        started = datetime.now(timezone.utc)
        _require(started < datetime.fromisoformat(authority.DEADLINE.replace('Z', '+00:00')))
        context.deadline()
        verify_financial_closure(context.finance['command'])
        seen, recipes = {}, {}
        def read(path, pin, mode=0o600, uid=0, limit=16_000_000):
            recipes[path] = (pin, mode, uid, limit)
            return _read(context, metadata, seen, path, pin, mode, uid, limit)
        manifest, _ = read(MANIFEST, authority.MANIFEST_SHA256, limit=2_000_000)
        seal = authority._json(manifest, authority.MANIFEST_SHA256)
        scheduler_bytes, _ = read(SCHEDULER, seal['files']['tooling/runtime_scheduler.py'], limit=1_000_000)
        wrapper_bytes, _ = read(WRAPPER, seal['files']['tooling/background-runner.sh'], limit=100_000)
        _require(seal['files']['tooling/treasury_owner_contract.py'] == DEPENDENCY_SHA256)
        read(DEPENDENCY, DEPENDENCY_SHA256, limit=1_000_000)
        original, _ = read(ORIGINAL, authority.ORIGINAL_CONFIGURATION_SHA256, limit=131072)
        candidate, _ = read(CANDIDATE, authority.CANDIDATE_SHA256, limit=2_000_000)
        upstream, _ = read(CANDIDATE_CONFIGURATION, authority.CONFIGURATION_SHA256, limit=131072)
        pins = authority._source_pins(manifest, scheduler_bytes, wrapper_bytes)
        files, configuration = {}, None
        for name, pin in sorted(pins.items()):
            uid, mode = (65532, 0o600) if name == authority.CONFIGURATION else (0, 0o444)
            raw, files[name] = read(Path(name), pin, mode, uid)
            if name == authority.CONFIGURATION:
                configuration = raw
        _require(configuration == upstream and authority._sha(authority.BACKGROUND_UNIT) == UNIT_SHA256)
        unit_bytes, files[authority.UNIT] = read(Path(authority.UNIT), UNIT_SHA256, 0o644)
        _require(unit_bytes == authority.BACKGROUND_UNIT)
        facts = dict(observedAt=started.isoformat().replace('+00:00', 'Z'), files=files,
                     **_facts(context.finance['command']))
        inputs = dict(manifest_bytes=manifest, candidate_bytes=candidate,
            original_configuration_bytes=original, configuration_bytes=configuration,
            scheduler_bytes=scheduler_bytes, wrapper_bytes=wrapper_bytes, facts=facts)
        authority.validate_worker_source_authority(**inputs)
        source_pins = {str(SCHEDULER): authority.SCHEDULER_SHA256, str(DEPENDENCY): DEPENDENCY_SHA256}
        scheduler = load_scheduler(SCHEDULER, source_pins)
        _require(scheduler.__file__ == str(SCHEDULER) and scheduler.IMAGE == authority.IMAGE
                 and callable(scheduler.units) and callable(scheduler.validate_container)
                 and scheduler.units()['background.service'].encode() == unit_bytes)
        for path, (pin, mode, uid, limit) in recipes.items():
            _read(context, metadata, seen, path, pin, mode, uid, limit)
        _require(authority._matches(_facts(context.finance['command']),
                                  {name: facts[name] for name in ('container', 'image', 'unit')}, exact=True))
        for path, fingerprint in seen.items():
            _require(_fingerprint(metadata(path)) == fingerprint)
        context.deadline()
        finished = datetime.now(timezone.utc)
        _require(os.geteuid() == 0 and 0 <= (finished - started).total_seconds() <= 60)
        return authority.validate_worker_source_authority(**inputs), scheduler
    except Exception:
        raise ValueError('worker_owner_refused') from None
