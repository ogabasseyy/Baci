import { evaluateMergePolicy } from './remediation-policy.mjs';
import { parseRemediationStatusFiles } from './remediation-status-files.mjs';

export function checkVerifiedRemediationChanges({
  runChecked,
  worktreeGitCommandOptions,
}) {
  const status = runChecked(
    'git',
    ['status', '--porcelain=v1', '-z', '-uall'],
    worktreeGitCommandOptions
  );
  const changedFiles = parseRemediationStatusFiles(status);
  if (changedFiles.length === 0) return { type: 'no_changes' };

  const policy = evaluateMergePolicy({
    changedFiles,
    checksPassed: true,
    hasHighSeverityReview: false,
    hasUnresolvedThreads: false,
  });
  if (!policy.allowed) {
    return { changedFiles, reasons: policy.reasons, type: 'policy_blocked' };
  }
  return { changedFiles, type: 'allowed' };
}
