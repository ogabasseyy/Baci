import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { buildRemediationVerificationCommand } from './remediation-codex-command.mjs';
import {
  assertCodexExecutionUsable,
  redactCodexError,
  redactCodexOutput,
} from './remediation-codex-output.mjs';
import { resumeCommittedRemediationBranch } from './remediation-committed-branch-resume.mjs';
import { createGuardedCodexRunner } from './remediation-docker-codex-runner.mjs';
import { assertConfiguredDockerImageAvailable } from './remediation-docker-image-preflight.mjs';
import { createRemediationDraftPrReconciler } from './remediation-draft-pr-reconciliation.mjs';
import { buildRemediationEnvironments } from './remediation-environments.mjs';
import { evaluateMergePolicy } from './remediation-policy.mjs';
import { runRemediationCodexPhases } from './remediation-research-gate.mjs';
import { writeRemediationResultArtifact } from './remediation-result-artifact.mjs';
import { findRetainedRemediationWorktree } from './remediation-retained-worktree.mjs';
import { parseRemediationStatusFiles } from './remediation-status-files.mjs';
import { runRemediationChecked as runChecked } from './remediation-subprocess.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';
import { cleanupRemediationAttempt } from './remediation-worktree-attempt-cleanup.mjs';
import { cleanupRemediationWorktree } from './remediation-worktree-cleanup.mjs';

function defaultRunner(command, args, options) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}
function runCodexChecked(command, args, options) {
  const result = options.runner(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    timeout: options.timeout,
  });
  if (result.error) throw redactCodexError(result.error);
  assertCodexExecutionUsable(result);
  return {
    output: [
      result.stdout
        ? ['stdout:', redactCodexOutput(result.stdout)].join('\n')
        : '',
      result.stderr
        ? ['stderr:', redactCodexOutput(result.stderr)].join('\n')
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    stdout: redactCodexOutput(result.stdout || ''),
  };
}
function sanitizeRunId(value) {
  const runId = String(value || randomUUID())
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return runId || randomUUID().toLowerCase().slice(0, 24);
}
export function runRemediationAutofix({
  candidate,
  containerIdentity,
  env = process.env,
  prompt,
  runner = defaultRunner,
}) {
  const repoDir = env.BACI_REPO_DIR;
  if (!repoDir) {
    throw new Error('BACI_REPO_DIR is required for autofix mode');
  }
  const runId = sanitizeRunId(env.BACI_REMEDIATION_RUN_ID);
  const commandEnv = { ...process.env, ...env };
  const {
    child: childEnv,
    gitIdentity: gitIdentityEnv,
    gitRemote: gitEnv,
  } = buildRemediationEnvironments(commandEnv);
  const worktreeRoot =
    env.BACI_REMEDIATION_WORKTREE_ROOT ||
    join(dirname(repoDir), 'baci-remediation-worktrees');
  let worktreeDir = join(worktreeRoot, `${candidate.fingerprint}-${runId}`);
  const rootCommandOptions = { cwd: repoDir, env: childEnv, runner };
  const rootRemoteCommandOptions = { cwd: repoDir, env: gitEnv, runner };
  const imageCheck = { env, options: rootCommandOptions, runner };
  const codexBin = env.CODEX_BIN || 'codex';
  const ghBin = env.GH_BIN || 'gh';
  const prReconciler = createRemediationDraftPrReconciler({
    candidate,
    ghBin,
    options: rootRemoteCommandOptions,
  });
  const { branch } = prReconciler;
  let cleanupCompletedWorktree = false;
  let cleanupWorktreeOnCompletion = false;
  let committedLocally = false;
  const retainFailedWorktree =
    env.BACI_REMEDIATION_RETAIN_FAILED_WORKTREE === '1';
  const cleanupTerminalWorktree = () =>
    (worktreeDir =
      cleanupRemediationWorktree({ branch, childEnv, repoDir, runner }) ||
      worktreeDir);
  try {
    runChecked('git', ['fetch', 'origin', 'main'], rootRemoteCommandOptions);
    const existingPrUrl = prReconciler.existingDraftPrUrl();
    if (existingPrUrl) {
      cleanupTerminalWorktree();
      return {
        branch,
        changedFiles: [],
        prUrl: existingPrUrl,
        type: 'pr_opened',
        worktreeDir,
      };
    }
    if (prReconciler.remoteBranchExists()) {
      cleanupTerminalWorktree();
      return {
        branch,
        changedFiles: [],
        prUrl: prReconciler.createOrReuseDraftPr(),
        type: 'pr_opened',
        worktreeDir,
      };
    }
    cleanupWorktreeOnCompletion = true;
    const retainedWorktreeDir = findRetainedRemediationWorktree({
      branch,
      childEnv,
      repoDir,
      runner,
    });
    if (retainedWorktreeDir) {
      worktreeDir = retainedWorktreeDir;
    } else {
      assertConfiguredDockerImageAvailable(imageCheck);
      runChecked(
        'git',
        ['worktree', 'add', worktreeDir, '-b', branch, 'origin/main'],
        rootCommandOptions
      );
    }
    const worktreeCommandOptions = { cwd: worktreeDir, env: childEnv, runner };
    const worktreeGitCommandOptions = {
      cwd: worktreeDir,
      env: gitIdentityEnv,
      runner,
    };
    const worktreeRemoteCommandOptions = {
      cwd: worktreeDir,
      env: gitEnv,
      runner,
    };
    const committedBranchResult =
      retainedWorktreeDir &&
      resumeCommittedRemediationBranch({
        onCommitted: () => {
          committedLocally = true;
        },
        prReconciler,
        rootCommandOptions,
        worktreeGitCommandOptions,
        worktreeRemoteCommandOptions,
      });
    if (committedBranchResult) return committedBranchResult;
    if (retainedWorktreeDir) {
      assertConfiguredDockerImageAvailable(imageCheck);
    }
    const guardedRunCodex = createGuardedCodexRunner({
      hasRetainedWorktree: Boolean(retainedWorktreeDir),
      onUnavailableImage: () => (cleanupCompletedWorktree = true),
      runCodex: runCodexChecked,
    });
    const codexPhases = runRemediationCodexPhases({
      candidate,
      codexBin,
      commandEnv,
      containerIdentity,
      prompt,
      repoDir,
      runner,
      runCodex: guardedRunCodex,
      worktreeCommandOptions,
      worktreeDir,
    });
    if (!codexPhases.research.accepted) {
      const resultPath = writeRemediationResultArtifact({
        candidate,
        output: codexPhases.researchExecution.output,
        outputDir: env.BACI_REMEDIATION_OUTPUT_DIR,
      });
      return {
        branch,
        reasons: codexPhases.research.reasons,
        resultPath,
        type: 'research_blocked',
        worktreeDir,
      };
    }
    const codexExecution = codexPhases.implementationExecution;
    const resultPath = writeRemediationResultArtifact({
      candidate,
      output: codexExecution.output,
      outputDir: env.BACI_REMEDIATION_OUTPUT_DIR,
    });
    const status = runChecked(
      'git',
      ['status', '--porcelain'],
      worktreeGitCommandOptions
    );
    if (!status.trim()) {
      cleanupCompletedWorktree = true;
      return { branch, resultPath, type: 'no_changes', worktreeDir };
    }
    const changedFiles = parseRemediationStatusFiles(status);
    const policy = evaluateMergePolicy({
      changedFiles,
      checksPassed: true,
      hasHighSeverityReview: false,
      hasUnresolvedThreads: false,
    });
    if (!policy.allowed) {
      if (retainedWorktreeDir) cleanupCompletedWorktree = true;
      return {
        branch,
        changedFiles,
        reasons: policy.reasons,
        resultPath,
        type: 'policy_blocked',
        worktreeDir,
      };
    }
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
    runChecked('git', ['add', '-A'], worktreeGitCommandOptions);
    runChecked(
      'git',
      [
        'commit',
        '-m',
        `Fix ${candidate.sample?.source || 'production'} error ${candidate.fingerprint}`,
      ],
      worktreeGitCommandOptions
    );
    committedLocally = true;
    runChecked(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'push', '-u', 'origin', branch],
      worktreeRemoteCommandOptions
    );
    const prUrl = prReconciler.createOrReuseDraftPr();
    cleanupCompletedWorktree = true;
    return {
      branch,
      changedFiles,
      prUrl,
      resultPath,
      type: 'pr_opened',
      worktreeDir,
    };
  } finally {
    cleanupRemediationAttempt(
      { branch, childEnv, repoDir, runner, worktreeDir },
      cleanupCompletedWorktree,
      cleanupWorktreeOnCompletion,
      committedLocally,
      retainFailedWorktree
    );
  }
}
