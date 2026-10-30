#!/usr/bin/env python3
"""Run descriptor-freeze tests in a unique disposable delegated cgroup v2.

This Linux CI harness never changes production worker files or units. CI sets
WORKER_RELEASE_REQUIRE_CGROUP=1 so missing kernel capabilities fail the job;
local runs may omit it to get an explicit skip.
"""
from __future__ import annotations

import os
import importlib.util
from pathlib import Path
import secrets
import subprocess
import sys
import time
import unittest

BIN = Path(__file__).resolve().parents[1] / "bin"
CGROUP_ROOT = Path("/sys/fs/cgroup")


def _capability_unavailable(reason: str) -> int:
    required = os.environ.get("WORKER_RELEASE_REQUIRE_CGROUP") == "1"
    print(f"{'FAIL' if required else 'SKIP'}: {reason}")
    return 1 if required else 0


def _open_directory_path_nofollow(path: Path) -> int:
    import stat

    if not path.is_absolute():
        raise OSError("directory path must be absolute")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:]:
            if component in ("", ".", "..") or "/" in component or "\\" in component:
                raise OSError("unsafe directory path component")
            before = os.stat(component, dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISDIR(before.st_mode):
                raise OSError("directory path component is not a real directory")
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=fd)
            opened = os.fstat(child)
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                os.close(child)
                raise OSError("directory component changed during open")
            os.close(fd)
            fd = child
        result, fd = fd, -1
        return result
    finally:
        if fd >= 0:
            os.close(fd)


def _write_at(directory_fd: int, name: str, value: bytes) -> None:
    fd = os.open(name, os.O_WRONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
    try:
        os.write(fd, value)
    finally:
        os.close(fd)


def _wait_empty(cgroup_fd: int) -> bool:
    sys.path.insert(0, str(BIN))
    from worker_release_descriptor_cgroup import require_empty_cgroup

    info = os.fstat(cgroup_fd)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            require_empty_cgroup(cgroup_fd, info.st_dev, info.st_ino)
            return True
        except Exception:
            time.sleep(0.05)
    return False


def _verify_pinned_cgroup_path(root_fd: int, name: str, expected) -> None:
    import stat

    path_info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    if not stat.S_ISDIR(path_info.st_mode):
        raise OSError("cleanup path is not a real directory")
    if (path_info.st_dev, path_info.st_ino) != (expected.st_dev, expected.st_ino):
        raise OSError("cleanup path inode differs from pinned cgroup")
    verify_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
    try:
        verify_info = os.fstat(verify_fd)
        if (verify_info.st_dev, verify_info.st_ino) != (expected.st_dev, expected.st_ino):
            raise OSError("cleanup open resolved to another cgroup inode")
        sys.path.insert(0, str(BIN))
        from worker_release_descriptor_cgroup import _require_cgroup2_fd
        _require_cgroup2_fd(verify_fd, expected.st_dev, expected.st_ino)
    finally:
        os.close(verify_fd)


def _load_freeze_tests():
    modules = []
    for name in ("worker_release_descriptor_freeze.test.py",
                 "worker_release_descriptor_freeze_cgroup.test.py"):
        spec = importlib.util.spec_from_file_location(
            f"worker_release_descriptor_ci_{len(modules)}", BIN / name)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load descriptor-freeze test module: {name}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def main() -> int:
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        return _capability_unavailable("disposable cgroup test requires a root Linux runner")
    try:
        root_fd = _open_directory_path_nofollow(CGROUP_ROOT)
    except OSError as exc:
        return _capability_unavailable(f"cannot open cgroup v2 root ({type(exc).__name__})")

    sys.path.insert(0, str(BIN))
    from worker_release_descriptor_cgroup import _require_cgroup2_fd

    root_info = os.fstat(root_fd)
    try:
        _require_cgroup2_fd(root_fd, root_info.st_dev, root_info.st_ino)
    except Exception as exc:
        os.close(root_fd)
        return _capability_unavailable(f"runner does not expose cgroup v2 ({type(exc).__name__})")

    name = f"worker-release-test-{secrets.token_hex(8)}"
    cgroup_fd = -1
    cgroup_info = None
    created = False
    try:
        try:
            os.mkdir(name, 0o755, dir_fd=root_fd)
            created = True
            cgroup_info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            cgroup_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=root_fd)
            opened_info = os.fstat(cgroup_fd)
            if (opened_info.st_dev, opened_info.st_ino) != (cgroup_info.st_dev, cgroup_info.st_ino):
                raise OSError("new cgroup path changed during open")
            from worker_release_descriptor_cgroup import _require_cgroup2_fd
            _require_cgroup2_fd(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
            if not os.path.exists(f"/proc/self/fd/{cgroup_fd}/cgroup.kill"):
                raise OSError("cgroup.kill is unavailable")
            probe = subprocess.Popen(("/bin/sleep", "30"), stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                _write_at(cgroup_fd, "cgroup.procs", f"{probe.pid}\n".encode("ascii"))
                probe.kill()
                probe.wait(timeout=5)
                if not _wait_empty(cgroup_fd):
                    raise OSError("delegated cgroup did not become empty")
            finally:
                if probe.poll() is None:
                    probe.kill()
                    probe.wait(timeout=5)
        except OSError as exc:
            return _capability_unavailable(
                f"runner lacks writable cgroup delegation or cgroup.kill ({type(exc).__name__})")

        os.environ["WORKER_RELEASE_TEST_CGROUP_PATH"] = str(CGROUP_ROOT / name)
        freeze_tests = _load_freeze_tests()
        suite = unittest.TestSuite(
            unittest.defaultTestLoader.loadTestsFromModule(module)
            for module in freeze_tests
        )
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        empty = _wait_empty(cgroup_fd)
        if not empty:
            print("FAIL: disposable cgroup still contains processes after tests")
        return 0 if result.wasSuccessful() and empty else 1
    finally:
        if cgroup_fd >= 0:
            try:
                if not _wait_empty(cgroup_fd):
                    _write_at(cgroup_fd, "cgroup.kill", b"1")
                    if not _wait_empty(cgroup_fd):
                        print("FAIL: could not drain disposable cgroup during cleanup", file=sys.stderr)
                        raise SystemExit(1)
            except OSError as exc:
                print(f"FAIL: cgroup cleanup failed ({type(exc).__name__})", file=sys.stderr)
                raise SystemExit(1) from exc
            os.close(cgroup_fd)
        if created:
            try:
                if cgroup_info is None:
                    raise OSError("missing pinned cgroup identity")
                _verify_pinned_cgroup_path(root_fd, name, cgroup_info)
                os.rmdir(name, dir_fd=root_fd)
            except OSError as exc:
                print(f"FAIL: disposable cgroup could not be removed ({type(exc).__name__})",
                      file=sys.stderr)
                raise SystemExit(1) from exc
        os.close(root_fd)


if __name__ == "__main__":
    raise SystemExit(main())
