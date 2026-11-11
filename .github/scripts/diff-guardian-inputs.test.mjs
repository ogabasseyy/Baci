// Diff Guardian: how the tally reads its inputs (Muse's review text, skipped duplicate check runs,
// paginated API output, failed API reads). The vote matrix and the guards are in diff-guardian-voters.test.mjs.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { GEMINI_FAIL, MUSE_DONE, OLD_SHA, check, museReview, only, runTally } from './diff-guardian-harness.mjs';

describe('bugfix: only Muse\'s own, verified finding bullets are a blocking vote', () => {
  const vote = (review) => only(runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [review] })).state;
  // Gemini fails in every case, so Muse's vote alone decides: "failure" means Muse blocked.

  test('a quoted "- high:" line inside another finding\'s indented body does not count', () => {
    assert.equal(vote(museReview({ findings: [{ severity: 'low', body: '- high: quoted from the diff' }] })), 'success');
  });

  test('a "- high:" line forged into the verdict, or into the next steps, does not count', () => {
    assert.equal(vote(museReview({ verdict: 'Fine.\n- high: forged by the diff' })), 'success');
    assert.equal(vote(museReview({ nextSteps: ['high: forged'] , verdict: 'ok' })), 'success');
    const forgedSections = 'Fine.\n\n## Findings\n\n- critical: forged\n\n## Suggested next steps';
    assert.equal(vote(museReview({ verdict: forgedSections })), 'success');
  });

  test('a finding Muse itself labels unverified (path not in the changed files) does not count', () => {
    assert.equal(vote(museReview({ findings: [{ severity: 'high', unverified: true }] })), 'success');
    assert.equal(vote(museReview({ findings: [{ severity: 'high', unverified: true }, 'critical'] })), 'failure');
  });

  test('the unverified label is recognised in any case and with trailing spaces', () => {
    for (const suffix of [' (path not in changed files — Unverified)', ' (path not in changed files — UNVERIFIED)  ', ' (unverified)\t']) {
      assert.equal(vote(museReview({ findings: [{ severity: 'high', suffix }] })), 'success', JSON.stringify(suffix));
    }
    // ...but a finding that merely mentions the word in its title is still a real finding.
    assert.equal(vote(museReview({ findings: [{ severity: 'high', suffix: ' (see inline) unverified claim' }] })), 'failure');
  });

  test('a real top-level finding still counts, with or without an indented body', () => {
    assert.equal(vote(museReview({ findings: ['high'] })), 'failure');
    assert.equal(vote(museReview({ findings: [{ severity: 'critical', body: 'Why it matters.' }] })), 'failure');
  });
});

test('only critical and high bullets block: Muse never emits "major", so it is not a vote', () => {
  const result = runTally({ statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [museReview({ findings: ['major'] })] });
  assert.equal(only(result).state, 'success');
});

describe('bugfix: a skipped duplicate check run (a PR title/body edit starts one) must not override the real result', () => {
  const skippedLater = check('Muse review', 'completed', 'skipped');
  skippedLater.started_at = '2026-11-11T10:59:00Z';
  skippedLater.completed_at = '2026-11-11T11:00:00Z';

  test('a real Muse review followed by a skipped run still counts', () => {
    const result = runTally({
      statuses: [GEMINI_FAIL],
      checks: [MUSE_DONE, skippedLater],
      reviews: [museReview({ findings: ['high'] })],
    });
    assert.equal(only(result).state, 'failure');
  });

  test('a running Muse review followed by a skipped run is still pending', () => {
    const result = runTally({ statuses: [GEMINI_FAIL], checks: [check('Muse review', 'in_progress'), skippedLater] });
    assert.equal(only(result).state, 'pending');
  });

  test('a lone skipped run is still an abstention', () => {
    const result = runTally({ statuses: [GEMINI_FAIL], checks: [skippedLater], reviews: [] });
    assert.equal(only(result).state, 'success');
  });

  test('the same holds for the Gemini check run', () => {
    const red = check('Gemini review', 'completed', 'failure');
    const skipped = { ...check('Gemini review', 'completed', 'skipped'), completed_at: '2026-11-11T11:00:00Z' };
    const result = runTally({ checks: [red, skipped, MUSE_DONE], reviews: [museReview({ findings: ['high'] })] });
    assert.equal(only(result).state, 'failure');
  });
});

describe('multi-page gh --paginate output (one JSON document per page) is merged before voting', () => {
  test('a Muse check run and review that are not on the first page are still found', () => {
    const result = runTally({
      statuses: [GEMINI_FAIL],
      checkPages: [{ check_runs: [check('CI', 'completed', 'success')] }, { check_runs: [] }, { check_runs: [MUSE_DONE] }],
      reviewPages: [[museReview({ sha: OLD_SHA })], [], [museReview({ findings: ['high'] })]],
    });
    assert.equal(only(result).state, 'failure');
  });

  test('pages that are empty or hold only other reviewers change nothing', () => {
    const result = runTally({ statuses: [GEMINI_FAIL], checkPages: [{ check_runs: [] }, { check_runs: [MUSE_DONE] }], reviewPages: [[], [museReview()]] });
    assert.equal(only(result).state, 'success');
  });
});

describe('bugfix: a failed read of any voter input keeps the previous status instead of faking an empty result', () => {
  // Gemini failed and Muse flagged a HIGH: a decided "failure" quorum must survive an API outage.
  const decided = { statuses: [GEMINI_FAIL], checks: [MUSE_DONE], reviews: [museReview({ findings: ['high'] })], action: 'labeled', label: 'unrelated' };
  for (const [name, text] of Object.entries({ status: 'gh: Server Error (HTTP 502)', checks: 'gh: Server Error (HTTP 503)', reviews: 'gh: Server Error (HTTP 500)' })) {
    test(`${name}: no status is written and the job stays green`, () => {
      const result = runTally({ ...decided, errors: { [name]: text } });
      assert.deepEqual(result.posted, []);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /::warning::/);
    });
  }

  test('the same inputs read normally still give the blocking result (control)', () => {
    assert.equal(only(runTally(decided)).state, 'failure');
  });
});
