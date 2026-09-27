import { join } from 'node:path';
import { buildRemediationVerificationCommand } from './remediation-codex-command.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';

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
  try {
    runChecked(verificationCommand.command, verificationCommand.args, {
      ...worktreeCommandOptions,
      timeout: readPositiveInt(
        env.BACI_REMEDIATION_VERIFY_TIMEOUT_MS,
        30 * 60 * 1_000
      ),
    });
  } finally {
    if (verificationCommand.cleanup) {
      runner(
        verificationCommand.cleanup.command,
        verificationCommand.cleanup.args,
        { cwd: worktreeDir, env: childEnv, shell: false }
      );
    }
    for (const relativePath of verificationCommand.dependencyCopyPaths ||
      []) {
      runChecked('rm', ['-rf', '--', join(worktreeDir, relativePath)], {
        cwd: worktreeDir,
        env: childEnv,
        runner,
      });
    }
  }
}
