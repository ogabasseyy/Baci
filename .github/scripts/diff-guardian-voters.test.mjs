// Contract + behaviour tests for .github/workflows/diff-guardian.yml.
// Runs the workflow's real tally script against canned GitHub API responses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import { GEMINI_FAIL, GEMINI_OK, MUSE_DONE, OLD_SHA, SCRIPT_DIR, SHA, check, geminiReview, museReview, only, runTally, status, tallyStep, workflow } from './diff-guardian-harness.mjs';

test('contract: the voters are Gemini and Muse with a quorum of two; Jules is no longer tallied', () => {
  assert.equal(tallyStep.env.VOTERS, 'Gemini review|Muse review');
  assert.equal(tallyStep.env.BLOCK_QUORUM, '2');
  const triggers = workflow.on ?? workflow[true];
  assert.deepEqual(triggers.workflow_run.workflows, ['Gemini Code Review', 'Muse Code Review']);
});

test('contract: reads workflow state and only ever checks out the DEFAULT branch, never pull-request code', () => {
  assert.equal(workflow.permissions.actions, 'read');
  assert.equal(workflow.permissions.statuses, 'write');
  const checkouts = workflow.jobs.guardian.steps.filter((step) => String(step.uses ?? '').startsWith('actions/checkout'));
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0].uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.equal(checkouts[0].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(checkouts[0].with['persist-credentials'], false);
  assert.equal(checkouts[0].with['sparse-checkout'], '.github/scripts/diff-guardian');
  assert.ok(!JSON.stringify(workflow.jobs).includes('pull_request.head.ref'), 'no step may use the pull request branch');
});

test('contract: the script comes from the trusted checkout and no untrusted value is interpolated into it', () => {
  assert.equal(tallyStep.run, 'bash "${SCRIPT_DIR}/tally.sh"');
  assert.equal(tallyStep.env.SCRIPT_DIR, '${{ github.workspace }}/.github/scripts/diff-guardian');
  for (const step of workflow.jobs.guardian.steps) assert.ok(!(step.run ?? '').includes('${{'), step.name);
});

test('contract: every variable the scripts read is provided by the workflow step', () => {
  const source = ['tally.sh', 'votes.sh'].map((file) => readFileSync(`${SCRIPT_DIR}/${file}`, 'utf8')).join('\n');
  const runnerProvided = new Set(['GITHUB_RUN_ID']);
  const read = ['GH_TOKEN', 'REPO', 'SHA', 'PR', 'EVENT_ACTION', 'EVENT_LABEL', 'VOTERS', 'BLOCK_QUORUM', 'SCRIPT_DIR'].filter((name) => new RegExp(`\\$\\{?${name}\\b`).test(source) || name === 'GH_TOKEN');
  for (const name of read) assert.ok(name in tallyStep.env || runnerProvided.has(name), `${name} is read but not provided`);
});

test('bugfix: the workflow and its scripts stay within the repository 300-line limit (the logic lives in scripts, not in YAML)', () => {
  for (const path of ['.github/workflows/diff-guardian.yml', `${SCRIPT_DIR}/tally.sh`, `${SCRIPT_DIR}/votes.sh`]) {
    const lines = readFileSync(path, 'utf8').split('\n').length;
    assert.ok(lines <= 300, `${path} has ${lines} lines`);
  }
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

describe('bugfix: voters that cannot report must not decide the gate', () => {
  test('a Gemini outage (status error plus a red check run) abstains instead of casting a blocking vote', () => {
    const result = runTally({
      statuses: [status('Gemini review', 'error')],
      checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview({ findings: ['high'] })],
    });
    assert.equal(only(result).state, 'success');
  });

  test('bugfix: a Gemini job that crashed without writing a status (red check run, no review) abstains instead of blocking', () => {
    const result = runTally({
      checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview({ findings: ['high'] })],
    });
    assert.equal(only(result).state, 'success');
  });

  test('but a red Gemini job whose posted review says failure still counts: the status write was lost, the finding was not', () => {
    const result = runTally({
      checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview({ findings: ['high'] }), geminiReview({ state: 'failure' })],
    });
    assert.equal(only(result).state, 'failure');
  });

  test('a red Gemini job counts a posted review only when it is for this commit and says failure', () => {
    for (const review of [geminiReview({ sha: OLD_SHA, state: 'failure' }), geminiReview({ state: 'success' }), { ...geminiReview({ state: 'failure' }), user: { login: 'someone' } }]) {
      const result = runTally({
        checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
        reviews: [museReview({ findings: ['high'] }), review],
      });
      assert.equal(only(result).state, 'success', JSON.stringify(review.body.slice(0, 70)));
    }
  });

  test('the newest posted Gemini review for the commit decides (a manual re-review replaces the first)', () => {
    const result = runTally({
      checks: [check('Gemini review', 'completed', 'failure'), MUSE_DONE],
      reviews: [museReview({ findings: ['high'] }), geminiReview({ state: 'failure', submitted: '2026-11-11T09:00:00Z' }), geminiReview({ state: 'success', submitted: '2026-11-11T10:30:00Z' })],
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

test('bugfix: a failed pull request lookup keeps the previous status and does not turn the job red', () => {
  const result = runTally({ prError: 'gh: Server Error (HTTP 502)', statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [museReview({ findings: ['high'] })] });
  assert.deepEqual(result.posted, [], 'no status is overwritten');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /::warning::/);
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
