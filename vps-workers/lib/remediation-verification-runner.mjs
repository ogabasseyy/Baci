import { lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildRemediationVerificationCommand } from './remediation-codex-command.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';

function removeWorktreeDependencyCopy(worktreeDir, relativePath) {
  const segments = relativePath.split(/[\\/]+/);
  if (
    !relativePath ||
    relativePath.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid remediation dependency cleanup path');
  }

  const worktreeStats = lstatSync(worktreeDir);
  if (!worktreeStats.isDirectory() || worktreeStats.isSymbolicLink()) {
    throw new Error('Refusing remediation cleanup outside a real worktree');
  }

  let currentPath = worktreeDir;
  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment);
    let stats;
    try {
      stats = lstatSync(currentPath);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error('Refusing remediation cleanup through a symlink');
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error('Refusing remediation cleanup through a non-directory');
    }
  }

  rmSync(currentPath, { force: true, recursive: true });
}

export function runRemediationVerification({
  childEnv,
  commandEnv,
  containerIdentity,
  env,
  repoDir,
  runChecked,
  runner,
  worktreeCommandOptions,
  worktreeDir,
}) {
  const verificationCommand = buildRemediationVerificationCommand({
    containerIdentity,
    env: commandEnv,
    repoDir,
    worktreeDir,
  });
  let verificationSucceeded = false;
  try {
    runChecked(verificationCommand.command, verificationCommand.args, {
      ...worktreeCommandOptions,
      timeout: readPositiveInt(
        env.BACI_REMEDIATION_VERIFY_TIMEOUT_MS,
        30 * 60 * 1_000
      ),
    });
    verificationSucceeded = true;
  } finally {
    const cleanupErrors = [];
    if (verificationCommand.cleanup) {
      runner(
        verificationCommand.cleanup.command,
        verificationCommand.cleanup.args,
        { cwd: worktreeDir, env: childEnv, shell: false }
      );
    }
    for (const relativePath of verificationCommand.dependencyCopyPaths ||
      []) {
      try {
        removeWorktreeDependencyCopy(worktreeDir, relativePath);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (verificationSucceeded && cleanupErrors.length > 0) {
      throw cleanupErrors[0];
    }
  }
}
