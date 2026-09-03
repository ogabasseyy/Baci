#!/usr/local/bin/node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RESTRICTED_SHELLS = {
  '/bin/bash': '/usr/local/libexec/baci-raw-bash',
  '/usr/bin/bash': '/usr/local/libexec/baci-raw-bash',
  '/bin/sh': '/usr/local/libexec/baci-raw-dash',
  '/usr/bin/sh': '/usr/local/libexec/baci-raw-dash',
  '/bin/dash': '/usr/local/libexec/baci-raw-dash',
  '/usr/bin/dash': '/usr/local/libexec/baci-raw-dash',
  '/usr/local/libexec/baci-real-bash': '/usr/local/libexec/baci-raw-bash',
  '/usr/local/libexec/baci-real-dash': '/usr/local/libexec/baci-raw-dash',
  '/usr/local/libexec/baci-shell-bash': '/usr/local/libexec/baci-raw-bash',
  '/usr/local/libexec/baci-shell-dash': '/usr/local/libexec/baci-raw-dash',
};

// Only the container's PID 1 may use this path for the trusted auth bootstrap.
const CODEX_LAUNCH_SHELL = '/usr/local/libexec/baci-real-dash';

function restrictedShell(invokedPath) {
  return RESTRICTED_SHELLS[invokedPath] ?? RESTRICTED_SHELLS['/bin/sh'];
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function runCodexShell({
  args = process.argv.slice(2),
  env = process.env,
  getgid = process.getgid,
  getuid = process.getuid,
  invokedPath = process.argv[1],
  pid = process.pid,
  setgid = process.setgid,
  setgroups = process.setgroups,
  setuid = process.setuid,
  spawn = spawnSync,
} = {}) {
  const uid = positiveInteger(env.BACI_CODEX_SHELL_UID);
  const gid = positiveInteger(env.BACI_CODEX_SHELL_GID);
  const currentUid = typeof getuid === 'function' ? getuid() : null;
  const currentGid = typeof getgid === 'function' ? getgid() : null;

  if (uid === null || gid === null) {
    return 126;
  }

  try {
    const isBootstrap =
      invokedPath === CODEX_LAUNCH_SHELL &&
      pid === 1 &&
      env.BACI_CODEX_SHELL_BOOTSTRAP === '1';
    if (!isBootstrap && (currentUid !== uid || currentGid !== gid)) {
      if (typeof setgroups === 'function') setgroups([]);
      setgid(gid);
      setuid(uid);
    }
  } catch {
    return 126;
  }

  return (
    spawn(restrictedShell(invokedPath), args, {
      env,
      stdio: 'inherit',
    }).status ?? 1
  );
}

const invokedAsShell =
  process.argv[1] &&
  (Object.hasOwn(RESTRICTED_SHELLS, process.argv[1]) ||
    import.meta.url === pathToFileURL(process.argv[1]).href);
if (invokedAsShell) {
  process.exit(runCodexShell());
}
