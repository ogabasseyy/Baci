#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from legacy_history_owner_diagnostic import run_apply
from legacy_history_owner_proof import (
    InvalidProof, parse_manifest, run_mode, strict_json, validate_proof,
)


CONTAINER = 'baci-isolated-savings-db-1'
DATABASE = 'postgres'
SYSTEM_IDENTIFIER = '7685292944002592802'
DEADLINE = '2026-09-29T15:59:10Z'
MAX_PROOF_BYTES = 8 * 1024 * 1024
MAX_SQL_BYTES = 2 * 1024 * 1024
MAX_BUNDLE_FILES = 16
PSQL = '/nix/var/nix/profiles/default/bin/psql'
MANIFEST_NAME = 'manifest.json'
CANDIDATE_NAME = 'legacy-enrollment-candidate.sql'
PROOF_MARKER = ":'owner_sealed_json'::jsonb"
RESULT_MARKERS = {'migrated': True, 'already_complete': False}
INCLUDE_RE = re.compile(r'^\\ir ([A-Za-z0-9][A-Za-z0-9._-]*\.sql)$')
FILE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$')
SHA_RE = re.compile(r'^[a-f0-9]{64}$')


class Refused(Exception):
    pass


def assert_root_directory(path, owner_uid=0, private_leaf=True):
    target = Path(path)
    if not target.is_absolute():
        raise Refused()
    current = Path('/')
    parts = target.parts[1:]
    for index, part in enumerate(parts):
        current = current / part
        try:
            metadata = os.lstat(current)
        except OSError:
            raise Refused() from None
        leaf = index == len(parts) - 1
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != owner_uid
            or metadata.st_mode & 0o022
            or (leaf and private_leaf and metadata.st_mode & 0o077)
        ):
            raise Refused()


def read_root_file(path, max_bytes, owner_uid=0):
    target = Path(path)
    assert_root_directory(target.parent, owner_uid)
    try:
        before = os.lstat(target)
        if (
            stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_mode & 0o7777 != 0o600
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > max_bytes
            or not hasattr(os, 'O_NOFOLLOW')
        ):
            raise Refused()
        descriptor = os.open(
            target, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0)
        )
        try:
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or opened.st_uid != owner_uid
                or opened.st_mode & 0o7777 != 0o600
                or opened.st_nlink != 1
                or (opened.st_dev, opened.st_ino)
                != (before.st_dev, before.st_ino)
            ):
                raise Refused()
            chunks = []
            remaining = max_bytes + 1
            while remaining:
                chunk = os.read(descriptor, min(65536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b''.join(chunks)
            if len(data) != before.st_size or len(data) > max_bytes:
                raise Refused()
            return data
        finally:
            os.close(descriptor)
    except OSError:
        raise Refused() from None


def verify_bundle_files(expected, contents):
    if set(contents) != set(expected):
        raise Refused()
    for name, digest in expected.items():
        if hashlib.sha256(contents[name]).hexdigest() != digest:
            raise Refused()


def _decode_bundle_file(name, contents):
    try:
        return contents[name].decode('utf-8')
    except (KeyError, UnicodeDecodeError):
        raise Refused() from None


def flatten_sql(files):
    referenced = set()
    active = set()

    def expand(name):
        if name in active:
            raise Refused()
        active.add(name)
        output = []
        for line in _decode_bundle_file(name, files).splitlines():
            stripped = line.strip()
            if stripped.startswith('\\ir'):
                match = INCLUDE_RE.fullmatch(stripped)
                if not match:
                    raise Refused()
                include = match.group(1)
                if include not in files:
                    raise Refused()
                referenced.add(include)
                output.append(expand(include))
            elif stripped.startswith('\\') and not (
                re.fullmatch(r'\\set [A-Za-z_][A-Za-z0-9_]* [A-Za-z0-9_-]+', stripped)
                or re.fullmatch(r'\\if .{1,160}', stripped)
                or stripped in ('\\else', '\\endif')
                or re.fullmatch(r'\\gset(?: [A-Za-z_][A-Za-z0-9_]*)?', stripped)
            ):
                raise Refused()
            else:
                output.append(line)
        active.remove(name)
        return '\n'.join(output)

    result = expand(CANDIDATE_NAME)
    if referenced != set(files) - {CANDIDATE_NAME}:
        raise Refused()
    if len(result.encode('utf-8')) > MAX_SQL_BYTES:
        raise Refused()
    return result


def validate_sql_pins(sql):
    required = (
        r"current_database\(\)\s*<>\s*'postgres'",
        r"observed\s*<>\s*'7685292944002592802'",
        r'clock_timestamp\(\)\s*>=\s*to_timestamp\(1790697550\)',
        r'FOR UPDATE OF mapping\s*,\s*customer\s*,\s*goal',
    )
    if (
        any(re.search(token, sql, re.IGNORECASE) is None for token in required)
        or 'legacy_enrollment_proof' not in sql
        or sql.count(PROOF_MARKER) != 1
    ):
        raise Refused()


def load_bundle(bundle_dir, owner_uid=0):
    directory = Path(bundle_dir)
    assert_root_directory(directory, owner_uid)
    try:
        names = {entry.name for entry in os.scandir(directory)}
    except OSError:
        raise Refused() from None
    manifest_bytes = read_root_file(directory / MANIFEST_NAME, 65536, owner_uid)
    manifest = strict_json(manifest_bytes)
    try:
        expected = parse_manifest(
            manifest, CONTAINER, DATABASE, SYSTEM_IDENTIFIER, DEADLINE,
            CANDIDATE_NAME, MAX_BUNDLE_FILES, FILE_RE, SHA_RE,
        )
    except InvalidProof:
        raise Refused() from None
    if names != set(expected) | {MANIFEST_NAME}:
        raise Refused()
    contents = {}
    for name in expected:
        data = read_root_file(directory / name, MAX_SQL_BYTES, owner_uid)
        contents[name] = data
    verify_bundle_files(expected, contents)
    sql = flatten_sql(contents)
    validate_sql_pins(sql)
    return sql


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def inject_proof(sql, proof):
    payload = json.dumps(proof, separators=(',', ':'), ensure_ascii=False)
    if sql.count(PROOF_MARKER) != 1:
        raise Refused()
    return 'SET standard_conforming_strings = on;\n' + sql.replace(
        PROOF_MARKER, f'{sql_literal(payload)}::jsonb', 1
    )


def psql_command():
    return [
        '/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'exec', '-i',
        CONTAINER, PSQL, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
        '-v', 'VERBOSITY=sqlstate', '-d', DATABASE,
    ]


def apply_sql(sql, runner=subprocess.run):
    return run_apply(
        sql, runner, psql_command(),
        {
            'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
            'LANG': 'C', 'LC_ALL': 'C',
            'DOCKER_HOST': 'unix:///var/run/docker.sock',
        },
        RESULT_MARKERS,
    )


def main(argv=None):
    if os.geteuid() != 0:
        print('{"status":"refused","changesMade":false}')
        return 1
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument('--bundle-dir', required=True)
    parser.add_argument('--proof')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--apply', action='store_true')
    apply_attempted = False
    proof_digest = None
    try:
        arguments = parser.parse_args(argv)
        sql = load_bundle(arguments.bundle_dir)
        proof_path = arguments.proof
        if not proof_path:
            raise Refused()
        proof_bytes = read_root_file(proof_path, MAX_PROOF_BYTES)
        proof_digest = hashlib.sha256(proof_bytes).hexdigest()
        proof = validate_proof(strict_json(proof_bytes))
        script = inject_proof(sql, proof)
        apply_attempted = arguments.apply
        result = run_mode(arguments.check, script, proof_digest, apply_sql)
        print(json.dumps(result, separators=(',', ':')))
        return 2 if result['status'] == 'apply-unconfirmed' else 0
    except (Refused, InvalidProof, OSError, ValueError):
        if apply_attempted:
            print(json.dumps({
                'status': 'apply-unconfirmed', 'changesMade': None,
                **({'proofSha256': proof_digest} if proof_digest else {}),
            }, separators=(',', ':')))
            return 2
        print('{"status":"refused","changesMade":false}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
