import argparse
import json
from pathlib import Path
import stat
import time

import deploy
from readiness import DIRECT_FUNDING_EXPECTATIONS, ReadinessRefused, verify


class Refused(RuntimeError):
    pass


def validate_current_nginx(content, predecessor_digest):
    tokens = []
    offset = 0
    for match in deploy.TOKEN.finditer(content):
        if match.start() != offset:
            raise Refused('Invalid Nginx token stream')
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value.strip(b"\"'"), match.start(), match.end()))
    if offset != len(content):
        raise Refused('Incomplete Nginx token stream')
    values = [token[0] for token in tokens]
    location = [b'location', b'=', deploy.FUNDING.encode(), b'{']
    locations = [index for index in range(len(values) - len(location) + 1)
                 if values[index:index + len(location)] == location]
    if len(locations) != 1:
        raise Refused('Expected one exact funding location')
    opening = locations[0] + len(location) - 1
    depth = 1
    closing = None
    for index in range(opening + 1, len(values)):
        if values[index] == b'{':
            depth += 1
        elif values[index] == b'}':
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing is None:
        raise Refused('Unclosed funding location')
    current_guard = [b'if', b'($request_method', b'!~', b'^(GET|POST)$)', b'{',
                     b'return', b'405', b';', b'}']
    predecessor_guard = b'if ($request_method !~ ^(POST)$) { return 405; }'
    guards = [index for index in range(opening + 1, closing - len(current_guard) + 1)
              if values[index:index + len(current_guard)] == current_guard]
    if len(guards) != 1:
        raise Refused('Nginx target does not contain the exact approved GET guard')
    start = tokens[guards[0]][1]
    end = tokens[guards[0] + len(current_guard) - 1][2]
    predecessor = content[:start] + predecessor_guard + content[end:]
    if deploy.render_nginx(predecessor, predecessor_digest) != content:
        raise Refused('Nginx target is not the pinned predecessor transformation')


def assert_lease():
    if time.time() >= deploy.EXPIRY:
        raise Refused('Fixed staging lease expired')


def assert_nginx_unchanged(content, metadata):
    current, current_metadata = deploy.secure_read(deploy.NGINX_TARGET, 262144)
    if current != content or deploy.fingerprint(current_metadata) != deploy.fingerprint(metadata):
        raise Refused('Nginx target identity changed during artifact upgrade')


def validate_backup(path, artifact):
    metadata = path.lstat()
    if (path.parent != artifact.ROOT.parent or
            not path.name.startswith(artifact.ROOT.name + '.rollback-') or
            not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022):
        raise Refused('Artifact rollback path is unsafe')


def rollback(backup, artifact):
    validate_backup(backup, artifact)
    candidate = artifact.load_pinned('funding-service-candidate.py', artifact.CANDIDATE_HASH)
    artifact.swap(backup, lambda: (
        candidate._verify_artifact_tree(backup),
        candidate._verify_service_artifact_access(backup),
    ))


def install():
    assert_lease()
    pins, artifact = deploy.load_bundle()
    with deploy.deployment_lock():
        nginx, metadata = deploy.secure_read(deploy.NGINX_TARGET, 262144)
        validate_current_nginx(nginx, pins['expectedNginxSha256'])
        baseline = {(method, route): deploy.probe(method, route) for method, route, _ in deploy.BASELINE}
        deploy.check_routes(baseline, updated=True)
        staged = artifact.prepare()
        assert_lease()
        activated_backup = None
        try:
            assert_nginx_unchanged(nginx, metadata)
            assert_lease()
            activated_backup = artifact.activate(staged)
            verify(
                DIRECT_FUNDING_EXPECTATIONS,
                lambda method, route, timeout: deploy.probe(method, route, timeout, direct=True),
                'funding-service-ready',
            )
            deploy.check_routes(baseline, updated=True)
            assert_nginx_unchanged(nginx, metadata)
            assert_lease()
            return {'status': 'active', 'leaseExpiresAt': deploy.EXPIRY,
                    'artifactBackup': str(activated_backup)}
        except BaseException:
            if activated_backup is not None:
                try:
                    rollback(activated_backup, artifact)
                    assert_nginx_unchanged(nginx, metadata)
                except Exception:
                    raise Refused('Upgrade failed and artifact rollback needs operator recovery') from None
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    options = parser.parse_args()
    if not options.install:
        raise Refused('Explicit --install required')
    print(json.dumps(install(), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        safe_types = (Refused, deploy.Refused, ReadinessRefused)
        print(json.dumps({'status': 'refused',
                          'errorType': type(error).__name__,
                          'reason': str(error) if type(error) in safe_types else 'redacted',
                          'readiness': error.report if type(error) is ReadinessRefused else None}), flush=True)
        raise SystemExit(1) from None
