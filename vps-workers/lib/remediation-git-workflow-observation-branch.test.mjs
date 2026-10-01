import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { remediationGitWorkflowTestFixtures } from './remediation-git-workflow.test-helpers.mjs';

const { candidate, makeRunner } = remediationGitWorkflowTestFixtures;

const observedCandidate = (overrides = {}) => ({
  ...candidate,
  caseKey: 'vercel:vercel_timeout:abc123',
  category: 'vercel_timeout',
  lastSeen: '2026-08-09T10:00:00.000Z',
  observationMarker: '2026-08-09T10:00:00.000Z',
  occurrences: 2,
  source: 'vercel',
  ...overrides,
});

const env = {
  BACI_REMEDIATION_RUN_ID: 'same-timestamp',
  BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
  BACI_REPO_DIR: '/repo',
  BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
};

describe('remediation observation branch identity', () => {
  it('uses a new pushed branch when occurrences grow at the same timestamp', () => {
    const { calls, runner } = makeRunner();
    const first = runRemediationAutofix({
      candidate: observedCandidate(),
      env,
      runner,
    });
    const recurrence = runRemediationAutofix({
      candidate: observedCandidate({ occurrences: 3 }),
      env,
      runner,
    });

    assert.equal(first.type, 'pr_opened');
    assert.equal(recurrence.type, 'pr_opened');
    assert.notEqual(first.branch, recurrence.branch);
    assert.deepEqual(
      calls
        .filter((call) => call.join(' ').includes(' push -u origin '))
        .map((call) => call.at(-1)),
      [first.branch, recurrence.branch]
    );
  });

  it('uses a new branch after a no-change worktree is removed for the recurrence', () => {
    const { calls, runner } = makeRunner({ statusOutput: '' });
    const first = runRemediationAutofix({
      candidate: observedCandidate(),
      env,
      runner,
    });
    const recurrence = runRemediationAutofix({
      candidate: observedCandidate({ occurrences: 3 }),
      env,
      runner,
    });

    assert.equal(first.type, 'no_changes');
    assert.equal(recurrence.type, 'no_changes');
    assert.notEqual(first.branch, recurrence.branch);
    assert.deepEqual(
      calls
        .filter((call) => call.join(' ').startsWith('git worktree add'))
        .map((call) => call[call.indexOf('-b') + 1]),
      [first.branch, recurrence.branch]
    );
    assert.equal(
      calls.filter((call) => call.join(' ').includes('worktree remove')).length,
      2
    );
  });
});
