"""Fixed secretless package smoke commands for the disconnected verifier."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Callable


def run_fixed_smokes(candidate: Path, fence_digest: str, *, execute_unit: Callable,
                     unit_name: Callable, rejected: type[Exception], max_seconds: int,
                     max_output_bytes: int, systemd_run: str, systemctl: str) -> tuple[str, ...]:
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise rejected("runtime verifier requires Linux root broker")
    if not Path(systemd_run).is_file() or not Path(systemctl).is_file():
        raise rejected("systemd runtime verifier is unavailable")
    web = candidate / "apps" / "web"
    tsx = web / "node_modules" / ".bin" / "tsx"
    workers = candidate / "vps-workers"
    modules = candidate / "node_modules"
    required_packages = (
        modules / "dotenv" / "package.json",
        modules / "@supabase" / "supabase-js" / "package.json",
        modules / "expo-server-sdk" / "package.json",
    )
    if (not tsx.is_file() or not os.access(tsx, os.X_OK) or not workers.is_dir()
            or not modules.is_dir() or any(not package.is_file() for package in required_packages)):
        raise rejected("candidate is missing fixed runtime smoke targets")
    properties = {
        "User": "65534", "Group": "65534", "SupplementaryGroups": "",
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
        "ReadOnlyPaths": str(candidate),
        "InaccessiblePaths": "/root /home /run /var/run /tmp /var/tmp /dev/shm /etc/baci-workers /srv/baci-workers/runtime /srv/baci-workers/locks",
    }
    worker_imports = (
        "try { const [dotenv, supabase, expo] = await Promise.all([import('dotenv'), import('@supabase/supabase-js'), import('expo-server-sdk')]); "
        "if (typeof dotenv.config !== 'function' || typeof supabase.createClient !== 'function' || typeof expo.Expo !== 'function') process.exit(2); "
        "const client = supabase.createClient('https://example.invalid', 'synthetic-smoke-key'); "
        "const push = new expo.Expo({ accessToken: 'synthetic-smoke-token' }); "
        "if (typeof client.from !== 'function' || typeof push.sendPushNotificationsAsync !== 'function') process.exit(3); "
        "} catch (error) { process.exit(error?.code === 'ERR_MODULE_NOT_FOUND' ? 21 : 22); }"
    )
    commands = (
        (web, ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production", str(tsx), "--version")),
        (workers, ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                   "/usr/bin/node", "--input-type=module", "-e", worker_imports)),
    )
    for index, (cwd, command) in enumerate(commands):
        execute_unit(unit_name(fence_digest, index), cwd, command, properties, index + 1)
    return ("web_tsx_version", "worker_production_dependency_imports")


__all__ = ["run_fixed_smokes"]
