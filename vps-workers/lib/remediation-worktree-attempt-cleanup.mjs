import { cleanupRemediationWorktree } from './remediation-worktree-cleanup.mjs';

export function cleanupRemediationAttempt(
  { branch, childEnv, repoDir, runner, worktreeDir },
  cleanupCompletedWorktree,
  cleanupWorktreeOnCompletion,
  committedLocally,
  retainFailedWorktree
) {
  if (!cleanupWorktreeOnCompletion) return;
  const removeWorktree =
    cleanupCompletedWorktree || !(committedLocally || retainFailedWorktree);
  cleanupRemediationWorktree({
    branch,
    childEnv,
    removeBranch: removeWorktree && !committedLocally,
    removeWorktree,
    repoDir,
    runner,
    worktreeDir,
  });
}
