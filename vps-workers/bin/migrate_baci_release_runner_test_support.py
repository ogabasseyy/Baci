import importlib.util
import io
import json
import os
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("migrate-baci-release-runner.py")
SPEC = importlib.util.spec_from_file_location("migrate_baci_release_runner", SCRIPT)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def make_archive(path: Path, members=None):
    entries = members or {
        "config.sh": (b"#!/bin/sh\n", 0o755),
        "run.sh": (b"#!/bin/sh\n", 0o755),
        "runsvc.sh": (b"#!/bin/sh\n", 0o755),
        "bin/Runner.Listener": (b"runner", 0o755),
    }
    with tarfile.open(path, "w:gz") as archive:
        for name, (content, mode) in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = mode
            archive.addfile(info, io.BytesIO(content))


class FakeResponse:
    def __init__(self, body, status):
        self.body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, size=-1):
        return self.body[:size]



class ReleaseRunnerTestFixture(unittest.TestCase):
    def _prepare_apply_fixture(self, base: Path):
        home = base / "baci-release"
        home.mkdir(mode=0o700)
        os.chmod(home, 0o700)
        old_runner = base / "legacy" / "actions-runner"
        old_runner.mkdir(parents=True)
        (old_runner / "keep.txt").write_text("legacy stays", encoding="utf-8")
        archive = base / "runner.tar.gz"
        make_archive(archive)
        verifier = base / "verify-isolation.sh"
        verifier.write_text("#!/bin/sh\n", encoding="utf-8")
        return home, old_runner, archive, verifier

    def _patch_apply_host(self, home: Path):
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_name="baci-release", pw_dir=str(home), pw_shell="/usr/sbin/nologin")
        return (
            patch.object(migration.os, "geteuid", return_value=0),
            patch.object(migration.pwd, "getpwnam", return_value=account),
            patch.object(migration.os, "getgrouplist", return_value=[os.getgid()]),
            patch.object(migration.grp, "getgrgid", return_value=SimpleNamespace(gr_name="baci-release")),
            patch.object(migration, "RUNNER_HOME", home),
            patch.object(migration, "RUNNER_ROOT", home / "actions-runner"),
        )

__all__ = ["migration", "make_archive", "FakeResponse", "ReleaseRunnerTestFixture", "SimpleNamespace", "patch", "Path", "os", "json", "io", "stat", "tarfile", "tempfile", "unittest"]
