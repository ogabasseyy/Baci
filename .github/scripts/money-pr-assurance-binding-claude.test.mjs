// The Claude family's table, alongside the Codex and owner tables in
// money-pr-assurance-binding.test.mjs: a verdict names the exact full head,
// answers the latest request for it, and fails when it was dismissed or
// hidden, edited by another login, or contradicted later.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIONS_BOT,
  CLAUDE,
  claudeRequest,
  claudeVerdict,
  comment,
  dismissed,
  editedAt,
  HEAD,
  hidden,
  loadRawConfig,
  OLD_HEAD,
  OWNER,
  review,
  verdictBlock,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import { evaluateReviewers } from './money-pr-assurance-reviews.mjs';

const { reviewers } = parseAssuranceConfig(loadRawConfig());

function familyState(name, comments, reviewList = []) {
  return evaluateReviewers({
    comments,
    reviews: reviewList,
    head: HEAD,
    reviewers,
  }).families[name].state;
}

function claudeReview(verdict, minute) {
  return {
    ...review(CLAUDE, verdictBlock({ verdict }), HEAD, minute),
    id: 2200 + minute,
    nodeId: `PRR_${2200 + minute}`,
  };
}

test('Claude: its verdict names the full head and answers the latest request', () => {
  const request = claudeRequest(1);
  const rows = [
    [
      'a PASS verdict after a request naming the full head',
      'pass',
      [request, claudeVerdict({}, 3)],
      [],
    ],
    ['a PASS verdict nobody requested', 'missing', [claudeVerdict({}, 3)], []],
    [
      'a request naming an earlier head',
      'missing',
      [claudeRequest(1, OWNER, OLD_HEAD), claudeVerdict({}, 3)],
      [],
    ],
    [
      'a verdict naming only a prefix of the head',
      'fail',
      [request, claudeVerdict({ sha: HEAD.slice(0, 12) }, 3)],
      [],
    ],
    [
      'a verdict naming another commit',
      'missing',
      [request, claudeVerdict({ sha: OLD_HEAD }, 3)],
      [],
    ],
    [
      'a verdict older than the latest request',
      'missing',
      [request, claudeVerdict({}, 3), claudeRequest(4)],
      [],
    ],
    [
      'a request last edited after the verdict was posted',
      'missing',
      [editedAt(request, 5, OWNER), claudeVerdict({}, 3)],
      [],
    ],
    [
      'a request edited by another login',
      'missing',
      [editedAt(request, 1, CLAUDE), claudeVerdict({}, 3)],
      [],
    ],
    [
      'a verdict edited by another login',
      'fail',
      [request, editedAt(claudeVerdict({}, 3), 4, OWNER)],
      [],
    ],
    [
      'a hidden PASS verdict',
      'fail',
      [request, hidden(claudeVerdict({}, 3))],
      [],
    ],
    [
      'a dismissed PASS review',
      'fail',
      [request],
      [dismissed(claudeReview('PASS', 3))],
    ],
    [
      'a dismissed newer FAIL review over an older PASS',
      'fail',
      [request, claudeVerdict({}, 3)],
      [dismissed(claudeReview('FAIL', 5))],
    ],
    [
      'a later FAIL verdict',
      'fail',
      [request, claudeVerdict({}, 3), claudeVerdict({ verdict: 'FAIL' }, 5)],
      [],
    ],
    [
      'a later PASS after a FAIL',
      'pass',
      [request, claudeVerdict({ verdict: 'FAIL' }, 3), claudeVerdict({}, 5)],
      [],
    ],
    // Claude rewrites an older comment to FAIL after a newer PASS; the edit
    // time decides, and blanking that FAIL by another login cannot bring
    // the PASS back.
    [
      'an older comment Claude later edits to FAIL',
      'fail',
      [
        request,
        claudeVerdict({}, 5),
        editedAt(
          claudeVerdict({}, 3),
          8,
          CLAUDE,
          verdictBlock({ verdict: 'FAIL' })
        ),
      ],
      [],
    ],
    [
      'that FAIL then blanked by another login',
      'fail',
      [
        request,
        claudeVerdict({}, 5),
        editedAt(claudeVerdict({}, 3), 9, OWNER, 'Nothing here.'),
      ],
      [],
    ],
    // Reviews are ordered by their last edit too, not their submission.
    [
      'a PASS review edited to FAIL after a PASS comment',
      'fail',
      [request, claudeVerdict({}, 5)],
      [
        editedAt(
          claudeReview('PASS', 3),
          8,
          CLAUDE,
          verdictBlock({ verdict: 'FAIL' })
        ),
      ],
    ],
    [
      'a FAIL review edited to PASS after a FAIL comment',
      'pass',
      [request, claudeVerdict({ verdict: 'FAIL' }, 5)],
      [editedAt(claudeReview('FAIL', 3), 8, CLAUDE, verdictBlock())],
    ],
    [
      'a verdict posted under the shared Actions identity',
      'missing',
      [request, comment(ACTIONS_BOT, verdictBlock(), 3)],
      [],
    ],
  ];
  for (const [name, expected, comments, reviewList] of rows) {
    assert.equal(familyState('claude', comments, reviewList), expected, name);
  }
});
