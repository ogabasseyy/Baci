// One table per signal family. Every signal must name the exact full head
// commit (directly, or through the request it answers), come after the
// latest request for that commit, and fail when it was dismissed or hidden,
// edited by another login, or contradicted later.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE,
  CODEX,
  codexClean,
  codexRequest,
  comment,
  dismissed,
  editedAt,
  HEAD,
  hidden,
  loadRawConfig,
  OLD_HEAD,
  OWNER,
  ownerApproval,
  review,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  evaluateOwnerSignoff,
  evaluateReviewers,
} from './money-pr-assurance-reviews.mjs';

const { reviewers, ownerSignoff } = parseAssuranceConfig(loadRawConfig());

function familyState(name, comments, reviewList = []) {
  return evaluateReviewers({
    comments,
    reviews: reviewList,
    head: HEAD,
    reviewers,
  }).families[name].state;
}

function codexFindings(minute, commitId = HEAD) {
  return {
    ...review(
      CODEX,
      '<!-- codex-review-receipt:v1 -->\nfindings',
      commitId,
      minute
    ),
    id: 2100 + minute,
    nodeId: `PRR_${2100 + minute}`,
  };
}

function codexSummary(minute, { sha = HEAD, unresolved = true } = {}) {
  const state = JSON.stringify({
    code_review: { commit_sha: sha, has_unresolved_findings: unresolved },
  });
  return editedAt(
    comment(CODEX, `<!-- codex-review-state:v1 ${state} -->`, 0, {
      id: 4000,
      nodeId: 'IC_4000',
    }),
    minute,
    CODEX
  );
}

test('Codex: its clean verdict is bound to the exact head and the latest request', () => {
  const rows = [
    [
      'a clean comment after a request naming the full head',
      'pass',
      [codexRequest(1), codexClean(HEAD, 2)],
    ],
    [
      'no request at all (an automatic general review)',
      'missing',
      [codexClean(HEAD, 2)],
    ],
    [
      'a request naming only a prefix of the head',
      'missing',
      [
        comment(
          OWNER,
          codexRequest(1).body.replace(HEAD, HEAD.slice(0, 12)),
          1,
          { id: 3001 }
        ),
        codexClean(HEAD, 2),
      ],
    ],
    // A request for an earlier head never carries over, even when Codex
    // said nothing about that head.
    [
      'a request naming an earlier head, then an automatic clean',
      'missing',
      [codexRequest(1, OWNER, OLD_HEAD), codexClean(HEAD, 5)],
    ],
    [
      'a clean comment naming another commit',
      'missing',
      [codexRequest(1), codexClean(OLD_HEAD, 2)],
    ],
    [
      'a clean comment older than the latest request',
      'missing',
      [codexRequest(1), codexClean(HEAD, 2), codexRequest(3)],
    ],
    [
      'a request last edited after the clean comment',
      'missing',
      [editedAt(codexRequest(1), 3, OWNER), codexClean(HEAD, 2)],
    ],
    [
      'a request from another login',
      'missing',
      [codexRequest(1, 'someone-else'), codexClean(HEAD, 2)],
    ],
    [
      'a request edited by another login',
      'missing',
      [editedAt(codexRequest(1), 1, CLAUDE), codexClean(HEAD, 2)],
    ],
    [
      'a hidden request',
      'missing',
      [hidden(codexRequest(1)), codexClean(HEAD, 2)],
    ],
    [
      'a clean comment edited by another login',
      'missing',
      [codexRequest(1), editedAt(codexClean(HEAD, 2), 2, OWNER)],
    ],
    [
      'a hidden clean comment',
      'missing',
      [codexRequest(1), hidden(codexClean(HEAD, 2))],
    ],
    [
      'a later Codex comment edited by another login',
      'fail',
      [
        codexRequest(1),
        codexClean(HEAD, 2),
        editedAt(comment(CODEX, 'x', 5), 6, OWNER),
      ],
    ],
    [
      'a later hidden Codex comment',
      'fail',
      [codexRequest(1), codexClean(HEAD, 2), hidden(comment(CODEX, 'x', 5))],
    ],
    [
      'a later summary reporting findings on the head',
      'fail',
      [codexRequest(1), codexClean(HEAD, 2), codexSummary(6)],
    ],
    [
      'a later summary about another commit',
      'pass',
      [
        codexRequest(1),
        codexClean(HEAD, 2),
        codexSummary(6, { sha: OLD_HEAD }),
      ],
    ],
  ];
  for (const [name, expected, comments] of rows) {
    assert.equal(familyState('codex', comments), expected, name);
  }
  const reviewRows = [
    ['a later findings review on the head', 'fail', [codexFindings(6)]],
    [
      'a later findings review on the head, dismissed',
      'fail',
      [dismissed(codexFindings(6))],
    ],
    [
      'a findings review edited after the clean comment',
      'fail',
      [editedAt(codexFindings(1), 6, CODEX)],
    ],
    ['a findings review before the clean comment', 'pass', [codexFindings(1)]],
    [
      'a later findings review on another commit',
      'pass',
      [codexFindings(6, OLD_HEAD)],
    ],
  ];
  for (const [name, expected, reviewList] of reviewRows) {
    assert.equal(
      familyState('codex', [codexRequest(1), codexClean(HEAD, 2)], reviewList),
      expected,
      name
    );
  }
});
test('Owner sign-off: it names the full head and is withdrawn by dismissal, edits or a later change request', () => {
  const ownerReview = (body, minute, state = 'COMMENTED') => ({
    ...review(OWNER, body, HEAD, minute),
    id: 2300 + minute,
    nodeId: `PRR_${2300 + minute}`,
    userType: 'User',
    state,
  });
  const rows = [
    ['a comment naming the full head', true, [ownerApproval()], []],
    [
      'a review body naming the full head',
      true,
      [],
      [ownerReview(`summary-approved ${HEAD}`, 4)],
    ],
    [
      'only the seven-character prefix',
      false,
      [ownerApproval(HEAD.slice(0, 7))],
      [],
    ],
    [
      'a twelve-character prefix',
      false,
      [ownerApproval(HEAD.slice(0, 12))],
      [],
    ],
    ['another commit', false, [ownerApproval(OLD_HEAD)], []],
    ['another login', false, [ownerApproval(HEAD, 'someone-else')], []],
    [
      'a bot named like the owner',
      false,
      [{ ...ownerApproval(), userType: 'Bot' }],
      [],
    ],
    [
      'edited by another login',
      false,
      [editedAt(ownerApproval(), 5, CLAUDE)],
      [],
    ],
    ['edited by the owner', true, [editedAt(ownerApproval(), 5, OWNER)], []],
    ['a hidden comment', false, [hidden(ownerApproval())], []],
    [
      'a dismissed review',
      false,
      [],
      [dismissed(ownerReview(`summary-approved ${HEAD}`, 4))],
    ],
    [
      'a later change request from the owner',
      false,
      [ownerApproval()],
      [ownerReview('Not yet.', 6, 'CHANGES_REQUESTED')],
    ],
    [
      'a change request before the approval',
      true,
      [ownerApproval(HEAD, OWNER, 6)],
      [ownerReview('Not yet.', 4, 'CHANGES_REQUESTED')],
    ],
    [
      'a later change request that was dismissed',
      true,
      [ownerApproval()],
      [dismissed(ownerReview('Not yet.', 6, 'CHANGES_REQUESTED'))],
    ],
  ];
  for (const [name, expected, comments, reviewList] of rows) {
    assert.equal(
      evaluateOwnerSignoff({
        comments,
        reviews: reviewList,
        head: HEAD,
        ownerSignoff,
      }).approved,
      expected,
      name
    );
  }
  assert.match(
    evaluateOwnerSignoff({
      comments: [ownerApproval(HEAD.slice(0, 7))],
      reviews: [],
      head: HEAD,
      ownerSignoff,
    }).detail,
    new RegExp(`summary-approved ${HEAD}`)
  );
});
