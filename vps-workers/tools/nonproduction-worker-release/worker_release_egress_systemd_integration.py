#!/usr/bin/env python3
"""Disposable Linux/systemd integration proof for the disconnected egress prototype."""
from __future__ import annotations

import os
from pathlib import Path
import pwd
import grp
import re
import socket
import stat
import subprocess
import sys
import tempfile
import threading

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from worker_release_egress_broker import EgressBroker
from worker_release_egress_protocol import EgressRejected, encode_request, read_tls_client_hello
import worker_release_egress_broker as broker_module

SYNTHETIC_REPLY = b"synthetic-registry-response-v1"
_SAFE_DIAGNOSTIC = re.compile(r"[^A-Za-z0-9 _.,:=/@+()\-]")
from worker_release_egress_fixture_staging import FIXTURE_MODULES, stage_fixture_modules

def _safe_diagnostic(stdout: str, stderr: str, *, limit: int = 300) -> str:
    """Bound systemd fixture diagnostics to safe, printable synthetic evidence."""
    combined = " ".join(f"{stdout} {stderr}".split())
    filtered = _SAFE_DIAGNOSTIC.sub("?", combined)
    return filtered[-limit:] or "no diagnostic output"


def _namespace_failure_category(text: str) -> str:
    """Reduce disposable systemd namespace evidence to a fixed CI category."""
    value = text.lower()
    if not value.strip():
        return "journal-unavailable"
    if not any(marker in value for marker in (
            "mount namespac", "step namespace", "namespace setup", "failed to mount",
            "status=226", "status 226")):
        return "failure-unclassified"
    if "operation not permitted" in value or "permission denied" in value:
        return "namespace-permission"
    if "no such file or directory" in value or "not found" in value:
        return "namespace-path-missing"
    if "read-only file system" in value or "mount point is not" in value:
        return "namespace-mount-conflict"
    return "namespace-failure-unclassified"


def _namespace_missing_path(text: str, candidates: tuple[Path, ...]) -> str | None:
    """Return an exact fixture path only when the journal marks it missing."""
    missing = ("no such file or directory", "not found", "does not exist")
    for line in text.splitlines():
        lowered = line.lower()
        if not any(marker in lowered for marker in missing):
            continue
        for candidate in sorted((str(Path(path)) for path in candidates),
                                key=len, reverse=True):
            if candidate in line:
                return candidate
    return None


def _approved_socket_properties(host_socket: Path, source_alias: Path,
                               isolated_alias: Path) -> tuple[str, str]:
    """Mask host /run and bind the same approved socket inode from a safe alias."""
    host_socket = Path(host_socket)
    source_alias = Path(source_alias)
    isolated_alias = Path(isolated_alias)
    resolved_source = Path(os.path.realpath(source_alias))
    resolved_alias = Path(os.path.realpath(isolated_alias))
    if (not host_socket.is_absolute() or host_socket.parent != Path("/run")
            or host_socket != Path(os.path.normpath(str(host_socket)))
            or not source_alias.is_absolute()
            or source_alias == Path("/run") or Path("/run") in source_alias.parents
            or source_alias == Path("/var/run") or Path("/var/run") in source_alias.parents
            or source_alias != Path(os.path.normpath(str(source_alias)))
            or resolved_source == Path("/run") or Path("/run") in resolved_source.parents
            or not isolated_alias.is_absolute()
            or isolated_alias == Path("/run")
            or Path("/run") in isolated_alias.parents
            or isolated_alias == Path("/var/run")
            or Path("/var/run") in isolated_alias.parents
            or isolated_alias != Path(os.path.normpath(str(isolated_alias)))
            or resolved_alias == Path("/run") or Path("/run") in resolved_alias.parents):
        raise RuntimeError("egress fixture socket paths are outside fixed mount policy")
    # InaccessiblePaths=/run exits at systemd's NAMESPACE step on the
    # disposable Ubuntu runner (status 226). A fresh read-only tmpfs gives the
    # child an empty /run, so host AF_UNIX sockets remain unreachable. The
    # approved broker socket is separately exposed through the fixed alias
    # outside /run below.
    return ("--property=TemporaryFileSystem=/run:ro",
            f"--property=BindReadOnlyPaths={source_alias}:{isolated_alias}")


def _socket_bind_mount_command(host_socket: Path, source_alias: Path) -> tuple[str, ...]:
    """Return the fixed host bind-mount command for the same broker socket inode."""
    host_socket = Path(host_socket)
    source_alias = Path(source_alias)
    resolved_alias = Path(os.path.realpath(source_alias))
    if (not host_socket.is_absolute() or host_socket.parent != Path("/run")
            or host_socket != Path(os.path.normpath(str(host_socket)))
            or not source_alias.is_absolute() or source_alias == Path("/run")
            or Path("/run") in source_alias.parents or source_alias == Path("/var/run")
            or Path("/var/run") in source_alias.parents
            or source_alias != Path(os.path.normpath(str(source_alias)))
            or resolved_alias == Path("/run") or Path("/run") in resolved_alias.parents):
        raise RuntimeError("egress socket alias is outside fixed mount policy")
    return ("/usr/bin/mount", "--bind", str(host_socket), str(source_alias))


def _mount_socket_source_alias(host_socket: Path, source_alias: Path) -> tuple[int, int, int, int]:
    """Bind the /run socket inode to a protected outside-/run fixture path."""
    host_socket, source_alias = Path(host_socket), Path(source_alias)
    command = _socket_bind_mount_command(host_socket, source_alias)
    source_info = host_socket.lstat()
    parent_info = source_alias.parent.lstat()
    if (not stat.S_ISSOCK(source_info.st_mode) or source_info.st_uid != 0
            or source_info.st_nlink != 1 or not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid != 0 or parent_info.st_mode & 0o022
            or os.path.lexists(source_alias)):
        raise RuntimeError("approved socket source or alias parent is unsafe")
    placeholder = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        placeholder.bind(str(source_alias))
    finally:
        placeholder.close()
    os.chmod(source_alias, 0o600)
    placeholder_info = source_alias.lstat()
    placeholder_identity = (placeholder_info.st_dev, placeholder_info.st_ino,
                            placeholder_info.st_uid, placeholder_info.st_mode)
    source_identity = (source_info.st_dev, source_info.st_ino,
                       source_info.st_uid, source_info.st_mode)
    try:
        result = subprocess.run(command, check=False, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=5, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        if result.returncode != 0:
            raise RuntimeError("approved socket bind-mount setup failed")
        mounted_info = source_alias.lstat()
        if (mounted_info.st_dev, mounted_info.st_ino, mounted_info.st_uid,
                mounted_info.st_mode) != source_identity:
            raise RuntimeError("approved socket bind mount changed inode identity")
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        # A timeout can race with mount(8) completing. Remove only a mount
        # whose visible inode still proves it is the expected source socket.
        try:
            current = source_alias.lstat()
        except FileNotFoundError:
            current = None
        if (current is not None and
                (current.st_dev, current.st_ino, current.st_uid, current.st_mode)
                == source_identity):
            _unmount_socket_source_alias(
                source_alias, placeholder_identity=placeholder_identity,
                source_identity=source_identity)
        if isinstance(error, RuntimeError):
            raise
        raise RuntimeError("approved socket bind-mount setup failed") from error
    return placeholder_identity


def _unmount_socket_source_alias(source_alias: Path, *,
                                 placeholder_identity: tuple[int, int, int, int],
                                 source_identity: tuple[int, int, int, int]) -> None:
    """Unmount only the exact socket inode and require its placeholder back."""
    source_alias = Path(source_alias)
    current = source_alias.lstat()
    if (current.st_dev, current.st_ino, current.st_uid, current.st_mode) != source_identity:
        raise RuntimeError("approved socket alias changed before unmount")
    try:
        result = subprocess.run(("/usr/bin/umount", "--", str(source_alias)), check=False,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=5,
                                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("approved socket bind-mount cleanup failed") from error
    if result.returncode != 0:
        raise RuntimeError("approved socket bind-mount cleanup failed")
    placeholder = source_alias.lstat()
    if (placeholder.st_dev, placeholder.st_ino, placeholder.st_uid,
            placeholder.st_mode) != placeholder_identity:
        raise RuntimeError("approved socket placeholder changed during unmount")


def _unit_journal_text(unit: str) -> str:
    """Read bounded journal and unit status before its transient unit is reset."""
    if not re.fullmatch(r"worker-egress-(?:prototype|probe)-[0-9]{1,10}(?:-(?:base|mask|bind|combined))?", unit):
        return ""
    bin_path = HERE.parents[1] / "bin"
    if str(bin_path) not in sys.path:
        sys.path.insert(0, str(bin_path))
    from worker_release_bounded_process import run_bounded_capture

    try:
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
        journal = run_bounded_capture(
            ("/usr/bin/journalctl", "--no-pager", "--output=cat", "--lines=30",
             f"--unit={unit}.service"),
            timeout=2, max_stream_bytes=4096, env=env,
        )
        status = run_bounded_capture(
            ("/usr/bin/systemctl", "--system", "status", "--no-pager", "--full",
             f"{unit}.service"),
            timeout=2, max_stream_bytes=4096, env=env,
        )
        properties = run_bounded_capture(
            ("/usr/bin/systemctl", "--system", "show", "--no-pager",
             "--property=LoadState", "--property=ActiveState", "--property=SubState",
             "--property=Result", "--property=ExecMainCode", "--property=ExecMainStatus",
             "--property=StatusText", "--property=StatusErrno", "--property=ControlGroup",
             f"{unit}.service"),
            timeout=2, max_stream_bytes=2048, env=env,
        )
    except Exception:
        return ""
    return (journal.stdout + journal.stderr + status.stdout + status.stderr
            + properties.stdout + properties.stderr)


def _cleanup_systemd_unit(unit: str) -> None:
    """Stop/reset only the exact disposable unit after diagnostics are captured."""
    if not re.fullmatch(r"worker-egress-(?:prototype|probe)-[0-9]{1,10}(?:-(?:base|mask|bind|combined))?", unit):
        raise RuntimeError("egress fixture unit name is invalid")
    env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
    try:
        state = subprocess.run(("/usr/bin/systemctl", "--system", "show",
                                "--property=LoadState", "--value", f"{unit}.service"),
                               check=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True, timeout=5, env=env)
        if state.returncode != 0:
            raise RuntimeError("egress fixture unit cleanup failed")
        if state.stdout.strip() == "not-found":
            return
        stopped = subprocess.run(("/usr/bin/systemctl", "--system", "stop",
                                  f"{unit}.service"), check=False,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=10, env=env)
        reset = subprocess.run(("/usr/bin/systemctl", "--system", "reset-failed",
                                f"{unit}.service"), check=False,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=5, env=env)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("egress fixture unit cleanup failed") from error
    if stopped.returncode != 0 or reset.returncode != 0:
        raise RuntimeError("egress fixture unit cleanup failed")


def _namespace_probe_steps(mask_property: str, bind_property: str) -> tuple[tuple[str, ...], ...]:
    """Return diagnostic-only staged sandbox property sets, weakest to full."""
    base = ("--property=PrivateNetwork=yes", "--property=NoNewPrivileges=yes",
            "--property=PrivateUsers=yes", "--property=SupplementaryGroups=",
            "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6")
    return (
        ("base", *base),
        ("empty-run", *base, mask_property),
        ("bind", *base, bind_property),
        ("combined", *base, mask_property, bind_property),
    )


def _run_namespace_probes(*, unit_prefix: str, peer_uid: int, peer_gid: int,
                          socket_path: Path, source_alias: Path, isolated_alias: Path,
                          fixture_paths: tuple[Path, ...]) -> None:
    """Run true-only unit probes to identify which mount namespace stage fails."""
    if not re.fullmatch(r"[0-9]{1,10}", unit_prefix):
        raise RuntimeError("egress probe identity is invalid")
    mask_property, bind_property = _approved_socket_properties(
        socket_path, source_alias, isolated_alias)
    for label, *properties in _namespace_probe_steps(mask_property, bind_property):
        unit = f"worker-egress-probe-{unit_prefix}-{label}"
        command = ["/usr/bin/systemd-run", "--system", "--wait", "--pipe",
                   f"--unit={unit}", f"--uid={peer_uid}", f"--gid={peer_gid}",
                   *properties, "/usr/bin/true"]
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True,
                                    timeout=20)
            if result.returncode != 0:
                evidence = (result.stdout + "\n" + result.stderr
                            + "\n" + _unit_journal_text(unit))
                category = _namespace_failure_category(evidence)
                missing_path = _namespace_missing_path(evidence, fixture_paths)
                detail = _safe_diagnostic(result.stdout, result.stderr, limit=220)
                suffix = f" path={missing_path}" if missing_path else ""
                raise RuntimeError(
                    f"namespace probe {label} failed: {category}{suffix}; detail={detail}")
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(f"namespace probe {label} timed out") from error
        finally:
            _cleanup_systemd_unit(unit)


def _run_host_fixture() -> int:
    if os.geteuid() != 0 or Path("/proc/1/comm").read_text().strip() != "systemd":
        raise RuntimeError("requires root on a disposable systemd Linux VM")
    if not hasattr(socket, "SO_PEERCRED"):
        raise RuntimeError("Linux SO_PEERCRED is required")
    broker = EgressBroker.for_dedicated_bridge_account()
    peer_uid, peer_gid = broker.expected_peer_uid, broker.expected_peer_gid

    with tempfile.TemporaryDirectory(prefix="worker-egress-systemd-") as scratch:
        os.chmod(scratch, 0o711)
        scratch_root = Path(scratch)
        fixture_root = scratch_root / "fixture"
        fixture_client = stage_fixture_modules(Path(__file__).absolute().parents[3], fixture_root,
                                                 owner_uid=0, owner_gid=0)
        socket_path = Path(f"/run/baci-worker-egress-approved-{os.getpid()}.sock")
        socket_source_alias = scratch_root / "approved-source.sock"
        socket_alias = scratch_root / "approved-egress.sock"
        if socket_path.exists() or socket_path.is_symlink():
            raise RuntimeError("approved host socket fixture path already exists")
        if any(path.exists() or path.is_symlink()
               for path in (socket_source_alias, socket_alias)):
            raise RuntimeError("approved socket alias fixture path already exists")
        stopping = threading.Event()
        accepted = []
        registry_served = []
        registry_rejected = []
        synthetic_threads = []
        accepted_lock = threading.Lock()

        def synthetic_connect(host, port, **_kwargs):
            if host != "registry.npmjs.org" or port != 443:
                raise RuntimeError("synthetic connector received an unexpected destination")
            upstream, registry = socket.socketpair()
            with accepted_lock:
                accepted.append((upstream, registry))

            def serve_registry():
                try:
                    registry.settimeout(3)
                    read_tls_client_hello(registry, "registry.npmjs.org")
                    registry.sendall(SYNTHETIC_REPLY)
                    registry_served.append(True)
                except EgressRejected:
                    # Bridge or broker closed before forwarding a mismatched SNI.
                    registry_rejected.append(True)
                finally:
                    registry.close()

            thread = threading.Thread(target=serve_registry, daemon=True)
            synthetic_threads.append(thread)
            thread.start()
            return upstream

        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        hidden_listener = None
        accept_thread = None
        approved_identity = None
        hidden_identity = None
        approved_source_identity = None
        source_placeholder_identity = None
        hidden_host_socket = Path(f"/run/baci-worker-egress-hidden-{os.getpid()}.sock")
        try:
            listener.bind(str(socket_path))
            approved_identity = socket_path.lstat()
            os.chmod(socket_path, 0o666)
            approved_identity = socket_path.lstat()
            approved_source_identity = (approved_identity.st_dev, approved_identity.st_ino,
                                        approved_identity.st_uid, approved_identity.st_mode)
            # /run is a separate tmpfs on Ubuntu, so hard links to the temp fixture
            # root fail with EXDEV. A temporary bind mount aliases the exact socket
            # inode outside /run; systemd can resolve that source before masking /run.
            source_placeholder_identity = _mount_socket_source_alias(
                socket_path, socket_source_alias)
            # Give systemd an existing socket mountpoint for the namespace bind.
            alias_placeholder = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                alias_placeholder.bind(str(socket_alias))
                os.chmod(socket_alias, 0o600)
            finally:
                alias_placeholder.close()
            listener.listen(8)
            listener.settimeout(0.2)
            if hidden_host_socket.exists() or hidden_host_socket.is_symlink():
                raise RuntimeError("hidden host socket fixture path already exists")
            hidden_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            hidden_listener.bind(str(hidden_host_socket))
            hidden_identity = hidden_host_socket.lstat()
            os.chmod(hidden_host_socket, 0o666)
            hidden_identity = hidden_host_socket.lstat()
            hidden_listener.listen(1)
            _run_namespace_probes(
                unit_prefix=str(os.getpid()), peer_uid=peer_uid, peer_gid=peer_gid,
                socket_path=socket_path, source_alias=socket_source_alias,
                isolated_alias=socket_alias,
                fixture_paths=(socket_source_alias, socket_alias, socket_path,
                               hidden_host_socket, fixture_client, fixture_root,
                               scratch_root, Path("/run"), Path("/usr/bin/true")),
            )
            accept_thread = threading.Thread(target=broker.serve,
                                             args=(listener, stopping), daemon=True)
            accept_thread.start()
            # Ensure the peer credential gate rejects a root caller even when
            # its request would otherwise be approved. The connector count must
            # remain zero before the authorized systemd bridge is launched.
            malicious = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            malicious.connect(str(socket_path))
            malicious.sendall(encode_request("registry.npmjs.org", 443))
            malicious.settimeout(2)
            if malicious.recv(1) != b"\x01":
                raise RuntimeError("broker did not reject unauthorized peer UID/GID")
            malicious.close()
            if accepted:
                raise RuntimeError("unauthorized broker peer reached synthetic connector")

            # Patch only this test process's network connector. This fixture
            # does not resolve DNS or open any Internet connection.
            original_connect = broker_module.connect_public
            broker_module.connect_public = synthetic_connect
            try:
                unit = f"worker-egress-prototype-{os.getpid()}"
                command = [
                    "/usr/bin/systemd-run", "--system", "--wait", "--pipe",
                    f"--unit={unit}", f"--uid={peer_uid}",
                    f"--gid={peer_gid}", "--property=PrivateNetwork=yes",
                    *_approved_socket_properties(socket_path, socket_source_alias, socket_alias),
                    "--property=NoNewPrivileges=yes",
                    "--property=PrivateUsers=yes", "--property=SupplementaryGroups=",
                    "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                    "/usr/bin/python3", str(fixture_client), "--client",
                    str(socket_alias), str(os.stat("/proc/self/ns/net").st_ino),
                    str(hidden_host_socket),
                ]
                result = subprocess.run(command, check=False, capture_output=True,
                                        text=True, timeout=45)
                if result.returncode != 0:
                    journal = _unit_journal_text(unit)
                    evidence = result.stdout + "\n" + result.stderr + "\n" + journal
                    category = _namespace_failure_category(evidence)
                    missing_path = _namespace_missing_path(evidence, (
                        socket_source_alias, socket_alias, socket_path, hidden_host_socket,
                        fixture_client, fixture_root, scratch_root, Path("/run"),
                        Path("/usr/bin/python3"),
                    ))
                    if missing_path is not None:
                        category = f"{category} path={missing_path}"
                    raise RuntimeError(
                        f"systemd child failed (exit={result.returncode}; category={category})")
            finally:
                broker_module.connect_public = original_connect
                _cleanup_systemd_unit(unit)
            for thread in synthetic_threads:
                thread.join(timeout=3)
                if thread.is_alive():
                    raise RuntimeError("synthetic registry fixture did not drain")
            if len(accepted) != 3 or len(registry_served) != 1 or len(registry_rejected) != 2:
                raise RuntimeError("synthetic TLS route or SNI rejection evidence was incomplete")
        finally:
            stopping.set()
            listener.close()
            if hidden_listener is not None:
                hidden_listener.close()
            if (source_placeholder_identity is not None
                    and approved_source_identity is not None):
                _unmount_socket_source_alias(
                    socket_source_alias,
                    placeholder_identity=source_placeholder_identity,
                    source_identity=approved_source_identity,
                )
            for path, identity in ((socket_path, approved_identity),
                                   (hidden_host_socket, hidden_identity)):
                if identity is None:
                    continue
                try:
                    current = path.lstat()
                except FileNotFoundError:
                    continue
                if ((current.st_dev, current.st_ino, current.st_uid, current.st_mode)
                        != (identity.st_dev, identity.st_ino, identity.st_uid, identity.st_mode)):
                    raise RuntimeError("Unix socket fixture path changed before cleanup")
                path.unlink()
            if accept_thread is not None and accept_thread.ident is not None:
                accept_thread.join(timeout=2)
            for upstream, registry in accepted:
                for sock in (upstream, registry):
                    try:
                        sock.close()
                    except OSError:
                        pass
    return 0


def _host_mode() -> int:
    if os.geteuid() != 0 or Path("/proc/1/comm").read_text().strip() != "systemd":
        raise RuntimeError("requires root on a disposable systemd Linux VM")
    account = "baci-worker-egress-bridge"
    try:
        pwd.getpwnam(account)
        raise RuntimeError("dedicated integration account already exists")
    except KeyError:
        pass
    try:
        grp.getgrnam(account)
        raise RuntimeError("dedicated integration group already exists")
    except KeyError:
        pass
    subprocess.run(("/usr/sbin/groupadd", "--system", account), check=True,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    group_created = True
    user_created = False
    try:
        subprocess.run(("/usr/sbin/useradd", "--system", "--no-create-home",
                        "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin",
                        "--gid", account, account), check=True,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        user_created = True
        return _run_host_fixture()
    finally:
        if user_created:
            subprocess.run(("/usr/sbin/userdel", account), check=False,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
        if group_created:
            subprocess.run(("/usr/sbin/groupdel", account), check=False,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    try:
        raise SystemExit(_host_mode())
    except Exception as error:
        if isinstance(error, RuntimeError):
            detail = _safe_diagnostic(str(error), "")
            print(f"egress systemd integration failed: {detail}", file=sys.stderr)
        else:
            print(f"egress systemd integration failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
