// Contract + behaviour tests for .github/workflows/diff-guardian.yml.
// Runs the workflow's real tally script against canned GitHub API responses.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { OLD_SHA, SHA, check, museReview, runTally, status, tallyStep, workflow } from './diff-guardian-harness.mjs';

const GEMINI_OK = status('Gemini review', 'success');
const GEMINI_FAIL = status('Gemini review', 'failure');
const MUSE_DONE = check('Muse review', 'completed', 'success');
const only = (result) => {
  assert.equal(result.posted.length, 1, `expected exactly one status POST, got ${JSON.stringify(result.posted)}\n${result.stderr}`);
  return result.posted[0];
};

test('contract: the voters are Gemini and Muse with a quorum of two; Jules is no longer tallied', () => {
  assert.equal(tallyStep.env.VOTERS, 'Gemini review|Muse review');
  assert.equal(tallyStep.env.BLOCK_QUORUM, '2');
  const triggers = workflow.on ?? workflow[true];
  assert.deepEqual(triggers.workflow_run.workflows, ['Gemini Code Review', 'Muse Code Review']);
});

test('contract: reads workflow state but still never checks out or executes pull-request code', () => {
  assert.equal(workflow.permissions.actions, 'read');
  assert.equal(workflow.permissions.statuses, 'write');
  const uses = workflow.jobs.guardian.steps.map((step) => step.uses ?? '');
  assert.deepEqual(uses.filter((value) => value.startsWith('actions/checkout')), []);
});

test('passes when both reviewers are clean', () => {
  const result = runTally({
    statuses: [GEMINI_OK],
    checks: [MUSE_DONE],
    reviews: [museReview()],
  });
  assert.equal(only(result).state, 'success');
  assert.equal(result.code, 0, result.stderr);
});

test('blocks when Gemini and Muse both report a HIGH or CRITICAL finding', () => {
  for (const severity of ['high', 'critical']) {
    const result = runTally({
      statuses: [GEMINI_FAIL],
      checks: [MUSE_DONE],
      reviews: [museReview({ findings: [severity] })],
    });
    assert.equal(only(result).state, 'failure', severity);
    assert.equal(result.code, 1);
  }
});

test('does not block when only one reviewer reports a problem', () => {
  const geminiOnly = runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [museReview()] });
  assert.equal(only(geminiOnly).state, 'success');
  const museOnly = runTally({ statuses: [GEMINI_OK], checks: [MUSE_DONE], reviews: [museReview({ findings: ['high'] })] });
  assert.equal(only(museOnly).state, 'success');
});

test('a medium or low Muse finding is not a blocking vote', () => {
  const result = runTally({
    statuses: [GEMINI_FAIL],
    checks: [MUSE_DONE],
    reviews: [museReview({ findings: ['medium', 'low'] })],
  });
  assert.equal(only(result).state, 'success');
});

test('only critical and high bullets block: Muse never emits "major", so it is not a vote', () => {
  const result = runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [museReview({ findings: ['major'] })] });
  assert.equal(only(result).state, 'success');
});

describe('bugfix: voters that cannot report must not decide the gate', () => {
  test('a Gemini outage (status error plus a red check run) abstains instead of casting a blocking vote', () => {
    const result = runTally({
      statuses: [status('Gemini review', 'error')],
      checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview({ findings: ['high'] })],
    });
    assert.equal(only(result).state, 'success');
  });

  test('a disabled Gemini workflow abstains, so one Muse finding does not leave the gate pending forever', () => {
    const result = runTally({
      checks: [MUSE_DONE],
      reviews: [museReview({ findings: ['high'] })],
      workflows: { 'gemini-code-review.yml': 'disabled_manually' },
    });
    assert.equal(only(result).state, 'success');
  });

  test('a deleted voter workflow (404) abstains too', () => {
    const result = runTally({
      checks: [MUSE_DONE],
      reviews: [museReview({ findings: ['high'] })],
      workflows: { 'gemini-code-review.yml': { error: 'gh: Not Found (HTTP 404)' } },
    });
    assert.equal(only(result).state, 'success');
  });

  test('a retired Jules check run (still failing on old PRs) is not tallied', () => {
    const result = runTally({
      statuses: [GEMINI_FAIL],
      checks: [check('Jules review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview()],
    });
    assert.equal(only(result).state, 'success');
  });
});

test('keeps waiting while an enabled reviewer has not reported yet', () => {
  const result = runTally({
    checks: [MUSE_DONE],
    reviews: [museReview({ findings: ['high'] })],
    workflows: { 'gemini-code-review.yml': 'active' },
  });
  assert.equal(only(result).state, 'pending');
});

test('keeps waiting when the workflow lookup itself fails (unknown is not disabled)', () => {
  const result = runTally({
    checks: [MUSE_DONE],
    reviews: [museReview({ findings: ['high'] })],
    workflows: { 'gemini-code-review.yml': { error: 'gh: Server Error (HTTP 502)' } },
  });
  assert.equal(only(result).state, 'pending');
});

test('keeps waiting while Muse is still running', () => {
  const result = runTally({ statuses: [GEMINI_FAIL], checks: [check('Muse review', 'in_progress')] });
  assert.equal(only(result).state, 'pending');
});

test('Muse abstains on a fallback review, a stale review, a skipped job and its fail-closed job failure', () => {
  const cases = {
    fallback: { checks: [MUSE_DONE], reviews: [museReview({ fallback: true, findings: ['high'] })] },
    'review of an older commit': { checks: [MUSE_DONE], reviews: [museReview({ sha: OLD_SHA, findings: ['high'] })] },
    'no review at all': { checks: [MUSE_DONE], reviews: [] },
    'skipped job': { checks: [check('Muse review', 'completed', 'skipped')], reviews: [] },
    'fail-closed job failure': { checks: [check('Muse review', 'completed', 'failure')], reviews: [museReview({ findings: ['high'] })] },
  };
  for (const [name, fixture] of Object.entries(cases)) {
    const result = runTally({ statuses: [GEMINI_FAIL], ...fixture });
    assert.equal(only(result).state, 'success', name);
  }
});

test('ignores a Muse review that was not posted by github-actions[bot]', () => {
  const forged = { ...museReview({ findings: ['high'] }), user: { login: 'someone' } };
  const result = runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [forged] });
  assert.equal(only(result).state, 'success');
});

test('uses the newest Muse review for the head commit', () => {
  const older = museReview({ findings: ['high'], submitted: '2026-11-11T09:00:00Z' });
  const newer = museReview({ submitted: '2026-11-11T10:00:00Z' });
  const result = runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [older, newer] });
  assert.equal(only(result).state, 'success');
});

test('keeps the existing guards: bypass label, fork PRs, removed bypass label and stale triggers', () => {
  const bypass = runTally({ labels: ['bypass-ai-gate'] });
  assert.equal(only(bypass).state, 'success');
  const fork = runTally({ headRepo: 'someone/fork' });
  assert.equal(only(fork).state, 'failure');
  const removed = runTally({ action: 'unlabeled', label: 'bypass-ai-gate' });
  assert.equal(only(removed).state, 'failure');
  const stale = runTally({ sha: OLD_SHA, currentSha: SHA });
  assert.deepEqual(stale.posted, []);
  assert.equal(stale.code, 0);
});
