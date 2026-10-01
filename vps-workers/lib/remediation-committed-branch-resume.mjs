import { runRemediationChecked as runChecked } from './remediation-subprocess.mjs';
import { cleanupRemediationWorktree } from './remediation-worktree-cleanup.mjs';

export function resumeCommittedRemediationBranch({
  onCommitted,
  prReconciler,
  rootCommandOptions,
  worktreeGitCommandOptions,
  worktreeRemoteCommandOptions,
}) {
  const commitsAhead = runChecked(
    'git',
    ['rev-list', '--count', 'origin/main..HEAD'],
    worktreeGitCommandOptions
  ).trim();
  if (!/^\d+$/.test(commitsAhead)) {
    throw new Error(
      'git rev-list --count origin/main..HEAD returned invalid output'
    );
  }
  if (Number(commitsAhead) === 0) return null;

  const { branch } = prReconciler;
  onCommitted?.();
  runChecked(
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'push', '-u', 'origin', branch],
    worktreeRemoteCommandOptions
  );
  const prUrl = prReconciler.createOrReuseDraftPr();
  const worktreeDir = worktreeGitCommandOptions.cwd;
  cleanupRemediationWorktree({
    childEnv: rootCommandOptions.env,
    repoDir: rootCommandOptions.cwd,
    runner: rootCommandOptions.runner,
    worktreeDir,
  });

  return {
    branch,
    changedFiles: [],
    prUrl,
    type: 'pr_opened',
    worktreeDir,
  };
}
