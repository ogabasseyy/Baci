import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { readOnlyDockerSecurityArgs } from './remediation-readonly-seccomp.mjs';

export const REMEDIATION_VERIFY_COMMAND =
  'pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test';
function bindMount(source, destination, { readonly = false } = {}) {
  return `type=bind,src=${source},dst=${destination}${readonly ? ',readonly' : ''}`;
}

function containerNameFor(worktreeDir) {
  const suffix = basename(worktreeDir)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 42);
  return `baci-remediation-${suffix || process.pid}`;
}

function currentContainerIdentity() {
  return {
    gid: typeof process.getgid === 'function' ? process.getgid() : 1000,
    uid: typeof process.getuid === 'function' ? process.getuid() : 1000,
  };
}

function ensureRealDirectoryPath(root, destination) {
  const relativePath = relative(root, destination);
  const outsideRoot =
    isAbsolute(relativePath) || relativePath.split(sep)[0] === '..';
  if (outsideRoot) {
    throw new Error('dependency mount path must stay inside the worktree');
  }
  let current = root;
  for (const segment of ['', ...relativePath.split(sep).filter(Boolean)]) {
    if (segment) current = join(current, segment);
    if (existsSync(current)) {
      if (!lstatSync(current).isDirectory()) {
        throw new Error('dependency mount path must be a real directory');
      }
    } else {
      mkdirSync(current);
    }
  }
}

function buildDockerRuntimeArgs({
  containerName,
  readOnly = false,
  repoDir,
  worktreeDir,
}) {
  const { gid, uid } = currentContainerIdentity();
  return [
    'run',
    '--rm',
    '--name',
    containerName,
    '--cap-drop',
    'ALL',
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
    '--tmpfs',
    `/codex-home:rw,nosuid,nodev,size=64m,uid=${uid},gid=${gid},mode=700`,
    '--user',
    `${uid}:${gid}`,
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

function addDependencyMounts({
  args,
  dependencyRoot,
  prepareMountPoints = false,
  worktreeDir,
  destinationRoot = worktreeDir,
}) {
  for (const relativePath of [
    'node_modules',
    'apps/web/node_modules',
    'apps/mobile-admin/node_modules',
    'apps/mobile-storefront/node_modules',
  ]) {
    const source = join(dependencyRoot, relativePath);
    if (existsSync(source)) {
      const destination = join(destinationRoot, relativePath);
      if (prepareMountPoints) {
        ensureRealDirectoryPath(worktreeDir, destination);
      }
      args.push(
        '--mount',
        bindMount(source, destination, {
          readonly: true,
        })
      );
    }
  }
}

export function buildRemediationCodexCommand({
  codexBin,
  env,
  enableSearch = true,
  prompt,
  readOnly = false,
  repoDir,
  worktreeDir,
}) {
  const codexArgs = [
    ...(enableSearch ? ['--search'] : []),
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    readOnly ? 'read-only' : 'workspace-write',
    '-C',
    worktreeDir,
    prompt,
  ];
  const image = env.BACI_CODEX_DOCKER_IMAGE;
  if (!image) {
    return { args: codexArgs, command: codexBin };
  }

  const codexHome = env.CODEX_HOME || join(env.HOME, '.codex');
  const containerCodexBin = env.BACI_CODEX_CONTAINER_BIN;
  if (!containerCodexBin) {
    throw new Error(
      'BACI_CODEX_CONTAINER_BIN is required for Docker execution'
    );
  }
  const dockerBin = env.DOCKER_BIN || 'docker';
  const containerName = containerNameFor(worktreeDir);
  const dockerArgs = buildDockerRuntimeArgs({
    containerName,
    readOnly,
    repoDir,
    worktreeDir,
  });
  if (readOnly) {
    dockerArgs.push('--read-only', ...readOnlyDockerSecurityArgs(env));
  }
  dockerArgs.push(
    '--env',
    'CODEX_HOME=/codex-home',
    '--mount',
    bindMount(join(codexHome, 'auth.json'), '/codex-auth/auth.json', {
      readonly: true,
    }),
    '--mount',
    bindMount(containerCodexBin, '/opt/codex/bin/codex', { readonly: true })
  );
  const codexResources = join(
    dirname(containerCodexBin),
    '..',
    'codex-resources'
  );
  if (existsSync(codexResources)) {
    dockerArgs.push(
      '--mount',
      bindMount(codexResources, '/opt/codex/codex-resources', {
        readonly: true,
      })
    );
  }

  const dependencyRoot = env.BACI_REMEDIATION_DEPENDENCY_ROOT || repoDir;
  addDependencyMounts({
    args: dockerArgs,
    dependencyRoot,
    prepareMountPoints: readOnly,
    worktreeDir,
  });

  dockerArgs.push(
    '--workdir',
    worktreeDir,
    image,
    'sh',
    '-lc',
    'umask 077; mkdir -p "$CODEX_HOME"; chmod 700 "$CODEX_HOME"; cp /codex-auth/auth.json "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; exec /opt/codex/bin/codex "$@"',
    'codex',
    ...(enableSearch ? ['--search'] : []),
    ...(readOnly ? [] : ['--enable', 'use_legacy_landlock']),
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    ...(readOnly
      ? [
          '--sandbox',
          'read-only',
          // Landlock avoids nested bubblewrap user namespaces on this VPS
          // while retaining Codex's process-level filesystem/network policy.
          '--enable',
          'use_legacy_landlock',
        ]
      : [
          // Docker is the external write boundary for implementation runs.
          '--dangerously-bypass-approvals-and-sandbox',
        ]),
    '--ignore-user-config',
    '-C',
    worktreeDir,
    prompt
  );

  return {
    args: dockerArgs,
    cleanup: { args: ['rm', '-f', containerName], command: dockerBin },
    command: dockerBin,
  };
}

export function buildRemediationVerificationCommand({
  env,
  repoDir,
  worktreeDir,
}) {
  const verifyCommand = REMEDIATION_VERIFY_COMMAND;
  const image = env.BACI_CODEX_DOCKER_IMAGE;
  if (!image) {
    return { args: ['-lc', verifyCommand], command: 'bash' };
  }

  const dockerBin = env.DOCKER_BIN || 'docker';
  const containerName = `${containerNameFor(worktreeDir)}-verify`;
  const pnpmStorePath = join(
    dirname(worktreeDir),
    `${basename(worktreeDir)}-pnpm-store`
  );
  if (existsSync(pnpmStorePath)) {
    if (!lstatSync(pnpmStorePath).isDirectory()) {
      throw new Error('remediation pnpm store path must be a real directory');
    }
  } else {
    mkdirSync(pnpmStorePath, { recursive: true });
  }
  const dockerArgs = buildDockerRuntimeArgs({
    containerName,
    readOnly: false,
    repoDir,
    worktreeDir,
  });
  addDependencyMounts({
    args: dockerArgs,
    dependencyRoot: env.BACI_REMEDIATION_DEPENDENCY_ROOT || repoDir,
    destinationRoot: '/opt/remediation-dependencies',
    worktreeDir,
  });
  if (existsSync(pnpmStorePath)) {
    dockerArgs.push(
      '--mount',
      bindMount(pnpmStorePath, '/pnpm-store'),
      '--env',
      'pnpm_config_store_dir=/pnpm-store'
    );
  }
  const dependencyCopy = [
    'node_modules',
    'apps/web/node_modules',
    'apps/mobile-admin/node_modules',
    'apps/mobile-storefront/node_modules',
  ]
    .map(
      (relativePath) =>
        `[ ! -d /opt/remediation-dependencies/${relativePath} ] || (mkdir -p "$(dirname "${relativePath}")" && rm -rf "${relativePath}" && cp -a "/opt/remediation-dependencies/${relativePath}" "${relativePath}")`
    )
    .join(' && ');
  dockerArgs.push(
    '--workdir',
    worktreeDir,
    image,
    'sh',
    '-lc',
    `${dependencyCopy} && ${verifyCommand}`
  );

  return {
    args: dockerArgs,
    cleanup: { args: ['rm', '-f', containerName], command: dockerBin },
    dependencyCopyPaths: [
      'node_modules',
      'apps/web/node_modules',
      'apps/mobile-admin/node_modules',
      'apps/mobile-storefront/node_modules',
    ],
    command: dockerBin,
  };
}
