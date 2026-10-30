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
        # A read-only empty /run keeps host AF_UNIX sockets hidden. The
        # disposable Ubuntu systemd runner rejects InaccessiblePaths=/run at
        # namespace setup (status 226), while TemporaryFileSystem works.
        "TemporaryFileSystem": "/run:ro",
        # ProtectHome already masks /root and /home. Avoid /var/run's alias of
        # /run and keep the remaining fixed private paths inaccessible.
        "InaccessiblePaths": "/tmp /var/tmp /dev/shm /etc /srv /opt /usr/local /var/log /var/cache /var/spool /var/backups",
    }
    hidden_path_probe = (
        "import fs from 'node:fs'; "
        "for (const hidden of ['/srv/baci-workers/releases','/srv/baci-workers/runtime',"
        "'/srv/baci-workers/locks','/etc','/var/log','/var/cache','/var/spool',"
        "'/var/backups','/opt','/usr/local']) { "
        "try { fs.accessSync(hidden); process.exit(4); } "
        "catch (error) { if (!['ENOENT','EACCES','EPERM'].includes(error?.code)) process.exit(5); } } "
    )
    package_smokes = (
        # dotenv's public package entrypoint is CommonJS. Use the same Node
        # require path worker scripts use so the check does not depend on
        # Node's synthetic ESM named-export/TLA loader behavior.
        ("worker_dotenv", "import { createRequire } from 'node:module'; "
         "const m = createRequire(import.meta.url)('dotenv'); "
         "if (typeof m.config !== 'function') process.exit(2);"),
        ("worker_supabase", "const m = await import('@supabase/supabase-js'); "
         "if (typeof m.createClient !== 'function') process.exit(2); "
         "const c = m.createClient('https://example.invalid', 'synthetic-smoke-key'); "
         "if (typeof c.from !== 'function') process.exit(3);"),
        ("worker_expo", "const m = await import('expo-server-sdk'); "
         "if (typeof m.Expo !== 'function') process.exit(2); "
         "const e = new m.Expo({ accessToken: 'synthetic-smoke-token' }); "
         "if (typeof e.sendPushNotificationsAsync !== 'function') process.exit(3);"),
    )
    commands = (
        ("apps/web", ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                       "apps/web/node_modules/.bin/tsx", "--version")),
        *( ("vps-workers", ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                             "/usr/bin/node", "--input-type=module", "-e",
                             script + hidden_path_probe))
           for _label, script in package_smokes ),
    )
    for index, (cwd, command) in enumerate(commands):
        # The durable runtime-view journal's fixed identity suffix is 0/1.
        # Each unit still gets a fresh random nonce, so the three worker API
        # checks remain distinct and independently classifiable.
        unit = unit_name(fence_digest, 0 if index == 0 else 1)
        candidate_identity = candidate.lstat()
        view = create_runtime_view(
            unit, candidate_path=candidate, fence_digest=fence_digest,
            runtime_uid=runtime_uid,
            candidate_identity=(candidate_identity.st_dev, candidate_identity.st_ino))
        view_properties = dict(properties)
        if index > 0:
            # Three isolated Node units stay within the former 30-second
            # aggregate import budget while leaving the web CLI's own 35s cap.
            view_properties["RuntimeMaxSec"] = "10"
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
