import argparse
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path

from verify_policy_candidate import verify_policy_candidate


MAX_BYTES = 65536


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate-json-field')
        result[key] = value
    return result


def _constant(value):
    raise ValueError('nonfinite-json-number')


def _read(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077
                or metadata.st_size > MAX_BYTES):
            raise ValueError('private-input-invalid')
        content = stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError('input-too-large')
        return json.loads(content, object_pairs_hook=_object, parse_constant=_constant)


def prepare_policy_candidate(bundle_path, reviewed_pins_path, output_path, now):
    report = verify_policy_candidate(_read(bundle_path), _read(reviewed_pins_path), now)
    content = (json.dumps(report, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
    try:
        descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if _read(output_path) != report:
            raise ValueError('existing-artifact-conflict')
        return report, 'duplicate'
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    return report, 'created'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--reviewed-pins', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    try:
        now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        report, artifact_status = prepare_policy_candidate(
            arguments.bundle, arguments.reviewed_pins, arguments.output, now)
        print(json.dumps({'status': report['status'], 'artifactStatus': artifact_status,
                          'changesMade': False, 'liveWritesAllowed': False}))
        return 0 if report['status'] == 'prepared_inactive' else 2
    except (ValueError, OSError, TypeError, RecursionError, OverflowError):
        print(json.dumps({'status': 'preparation_refused', 'redacted': True,
                          'changesMade': False, 'liveWritesAllowed': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
