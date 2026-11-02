// Codex's verdict is withdrawn by any later sign of findings on the head,
// including its review-summary comment, and by tampering with its comments.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  at,
  CODEX,
  claudeVerdict,
  codexClean,
  codexRequest,
  comment,
  HEAD,
  loadRawConfig,
  OLD_HEAD,
  OWNER,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import { evaluateReviewers } from './money-pr-assurance-reviews.mjs';

const { reviewers } = parseAssuranceConfig(loadRawConfig());

function codexState(comments) {
  return evaluateReviewers({
    comments: [...comments, claudeVerdict({}, 20)],
    reviews: [],
    head: HEAD,
    reviewers,
  }).families.codex;
}

// Codex keeps one summary comment per PR and edits it after each review.
function summary({ sha = HEAD, unresolved = true, created = 0, updated = 9 }) {
  const state = {
    code_review: {
      commit_sha: sha,
      has_any_findings: unresolved,
      has_unresolved_findings: unresolved,
      status: 'completed',
    },
  };
  return comment(
    CODEX,
    `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n## Codex Review Summary`,
    created,
    { id: 4000, nodeId: 'IC_4000', updatedAt: at(updated), editor: CODEX }
  );
}

test('a Codex summary reporting unresolved findings on the head after the clean withdraws it', () => {
  const result = codexState([
    codexRequest(1),
    codexClean(HEAD, 2),
    summary({}),
  ]);
  assert.equal(result.state, 'fail');
  assert.match(result.detail, /findings/);
});

test('a Codex summary for another commit, without findings or from before the clean does not', () => {
  for (const item of [
    summary({ sha: OLD_HEAD }),
    summary({ unresolved: false }),
    summary({ updated: 1 }),
  ]) {
    assert.equal(
      codexState([codexRequest(1), codexClean(HEAD, 2), item]).state,
      'pass'
    );
  }
});

test('a newer Codex comment edited by another login fails Codex even with an older clean', () => {
  const tampered = {
    ...codexClean(HEAD, 5),
    id: 1105,
    nodeId: 'IC_1105',
    body: 'Nothing here.',
    updatedAt: at(6),
    editor: OWNER,
  };
  const result = codexState([codexRequest(1), codexClean(HEAD, 2), tampered]);
  assert.equal(result.state, 'fail');
  assert.match(result.detail, /edited by ogabasseyy/);
  // A tampered summary is caught by its edit time even though it is old.
  const forgedSummary = { ...summary({ unresolved: false }), editor: OWNER };
  assert.equal(
    codexState([codexRequest(1), codexClean(HEAD, 2), forgedSummary]).state,
    'fail'
  );
});

test('a request edited after the clean comment does not count', () => {
  const editedLater = { ...codexRequest(1), updatedAt: at(3), editor: OWNER };
  assert.equal(codexState([editedLater, codexClean(HEAD, 2)]).state, 'missing');
  const editedBefore = { ...codexRequest(1), updatedAt: at(1), editor: OWNER };
  assert.equal(codexState([editedBefore, codexClean(HEAD, 2)]).state, 'pass');
});
