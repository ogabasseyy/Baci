import {
  formatBoundedSubprocessOutput,
  redactCodexError,
} from './remediation-codex-output.mjs';

export function findRetainedRemediationWorktree({
  branch,
  childEnv,
  repoDir,
  runner,
}) {
  const result = runner('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoDir,
    env: childEnv,
    shell: false,
  });
  if (result.error) throw redactCodexError(result.error);
  if (result.status !== 0) {
    throw new Error(
      `git worktree list --porcelain failed: ${formatBoundedSubprocessOutput(result)}`
    );
  }

  const expectedBranch = `branch refs/heads/${branch}`;
  const retained = (result.stdout || '').split(/\r?\n\r?\n/).find((record) => {
    const lines = record.split(/\r?\n/);
    return lines.includes(expectedBranch);
  });
  if (!retained) return '';

  const worktreeLine = retained
    .split(/\r?\n/)
    .find((line) => line.startsWith('worktree '));
  return worktreeLine?.slice('worktree '.length) || '';
}
