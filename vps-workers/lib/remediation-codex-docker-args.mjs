import { join } from 'node:path';

function bindMount(source, destination, { readonly = false } = {}) {
  return `type=bind,src=${source},dst=${destination}${readonly ? ',readonly' : ''}`;
}

export function buildCodexDockerRuntimeArgs({
  containerName,
  readOnly = false,
  repoDir,
  runtime,
  worktreeDir,
}) {
  return [
    'run',
    '--rm',
    '--name',
    containerName,
    '--entrypoint',
    runtime.launchShell,
    '--cap-drop',
    'ALL',
    ...runtime.capabilityArgs,
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '512',
    '--cpus',
    '1',
    '--memory',
    '2g',
    '--memory-swap',
    '2g',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=1g',
    ...runtime.identityArgs,
    '--env',
    'HOME=/tmp',
    '--env',
    'GIT_OPTIONAL_LOCKS=0',
    '--mount',
    bindMount(worktreeDir, worktreeDir, { readonly: readOnly }),
    '--mount',
    bindMount(join(repoDir, '.git'), join(repoDir, '.git'), {
      readonly: true,
    }),
  ];
}
