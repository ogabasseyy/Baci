"""Fixed secretless package smoke commands for the disconnected verifier."""
from __future__ import annotations

import os
import stat
import sys
from pathlib import Path
from typing import Callable

from worker_release_runtime_view import create_runtime_view


def run_fixed_smokes(candidate: Path, fence_digest: str, *, execute_unit: Callable,
                     unit_name: Callable, rejected: type[Exception], max_seconds: int,
                     max_output_bytes: int, systemd_run: str, systemctl: str,
                     runtime_uid: int, runtime_gid: int) -> tuple[str, ...]:
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise rejected("runtime verifier requires Linux root broker")
    if not Path(systemd_run).is_file() or not Path(systemctl).is_file():
        raise rejected("systemd runtime verifier is unavailable")
    if (type(runtime_uid) is not int or runtime_uid <= 0
            or type(runtime_gid) is not int or runtime_gid <= 0):
        raise rejected("candidate runtime group is invalid")
    try:
        candidate_info = candidate.lstat()
    except OSError as error:
        raise rejected("candidate runtime source is unavailable") from error
    if not stat.S_ISDIR(candidate_info.st_mode):
        raise rejected("candidate runtime source is not a directory")
    if ":" in str(candidate):
        raise rejected("candidate path cannot be represented as a bind source")
    modules = candidate / "node_modules"
    required_packages = (
        modules / "dotenv" / "package.json",
        modules / "@supabase" / "supabase-js" / "package.json",
        modules / "expo-server-sdk" / "package.json",
    )
    if (not modules.is_dir() or any(not package.is_file() for package in required_packages)):
        raise rejected("candidate is missing fixed runtime smoke targets")
    properties = {
        "User": str(runtime_uid), "Group": str(runtime_gid), "SupplementaryGroups": "",
        "NoNewPrivileges": "yes", "PrivateNetwork": "yes", "ProtectSystem": "strict",
        "ProtectHome": "yes", "PrivateTmp": "no", "PrivateDevices": "yes",
        "PrivateUsers": "yes", "ProtectControlGroups": "yes",
        "ProtectKernelTunables": "yes", "ProtectKernelModules": "yes",
        "ProtectKernelLogs": "yes", "ProtectProc": "invisible", "ProcSubset": "pid",
        "RestrictSUIDSGID": "yes", "RestrictRealtime": "yes",
        "CapabilityBoundingSet": "", "AmbientCapabilities": "",
        "RestrictAddressFamilies": "AF_UNIX", "TasksMax": "32",
        "MemoryMax": str(512 * 1024 * 1024), "CPUQuota": "100%",
        "RuntimeMaxSec": str(max_seconds), "LimitNOFILE": "256",
        "LimitFSIZE": str(max_output_bytes), "UMask": "0077",
        # ProtectHome already masks /root and /home. Avoid duplicate mount
        # entries and /var/run's alias of /run in the explicit path list.
        "InaccessiblePaths": "/run /tmp /var/tmp /dev/shm /etc /srv /opt /usr/local /var/log /var/cache /var/spool /var/backups",
    }
    worker_imports = (
        "try { const fs = await import('node:fs'); "
        "for (const hidden of ['/srv/baci-workers/releases','/srv/baci-workers/runtime','/srv/baci-workers/locks','/etc','/var/log','/var/cache','/var/spool','/var/backups','/opt','/usr/local']) { "
        "try { fs.accessSync(hidden); process.exit(4); } catch (error) { if (!['ENOENT','EACCES','EPERM'].includes(error?.code)) process.exit(5); } } "
        "const [dotenv, supabase, expo] = await Promise.all([import('dotenv'), import('@supabase/supabase-js'), import('expo-server-sdk')]); "
        "if (typeof dotenv.config !== 'function' || typeof supabase.createClient !== 'function' || typeof expo.Expo !== 'function') process.exit(2); "
        "const client = supabase.createClient('https://example.invalid', 'synthetic-smoke-key'); "
        "const push = new expo.Expo({ accessToken: 'synthetic-smoke-token' }); "
        "if (typeof client.from !== 'function' || typeof push.sendPushNotificationsAsync !== 'function') process.exit(3); "
        "} catch (error) { process.exit(error?.code === 'ERR_MODULE_NOT_FOUND' ? 21 : 22); }"
    )
    commands = (
        ("apps/web", ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                       "apps/web/node_modules/.bin/tsx", "--version")),
        ("vps-workers", ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                          "/usr/bin/node", "--input-type=module", "-e", worker_imports)),
    )
    for index, (cwd, command) in enumerate(commands):
        unit = unit_name(fence_digest, index)
        candidate_identity = candidate.lstat()
        view = create_runtime_view(
            unit, candidate_path=candidate, fence_digest=fence_digest,
            runtime_uid=runtime_uid,
            candidate_identity=(candidate_identity.st_dev, candidate_identity.st_ino))
        view_properties = dict(properties)
        view_properties["BindReadOnlyPaths"] = f"{candidate}:{view.candidate_path}"
        if (view_properties.get("Group") != str(runtime_gid)
                or view_properties.get("SupplementaryGroups") != ""
                or view_properties["BindReadOnlyPaths"] != f"{candidate}:{view.candidate_path}"):
            raise rejected("runtime unit identity or candidate bind is outside fixed policy")
        view_command = ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                        str(view.candidate_path / command[-2]), command[-1]) if index == 0 else command
        try:
            view.verify_target()
            execute_unit(unit, view.candidate_path / cwd, view_command,
                         view_properties, index + 1)
        except BaseException as error:
            if isinstance(error, rejected) and not getattr(error, "preserve_candidate_required", False):
                view.cleanup()
            else:
                view.abandon()
            raise
        else:
            view.cleanup()
    return ("web_tsx_version", "worker_production_dependency_imports")


__all__ = ["run_fixed_smokes"]
