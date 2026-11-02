import assert from 'node:assert/strict';
import test from 'node:test';
import {
  at,
  CLAUDE,
  CODEX,
  claudeVerdict,
  codexClean,
  codexRequest,
  comment,
  HEAD,
  loadRawConfig,
  OLD_HEAD,
  OWNER,
  ownerApproval,
  review,
  verdictBlock,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  countUnresolvedThreads,
  evaluateOwnerSignoff,
  evaluateReviewers,
  parseVerdictBlock,
  shaMatchesHead,
} from './money-pr-assurance-reviews.mjs';

const { reviewers, ownerSignoff } = parseAssuranceConfig(loadRawConfig());

// Codex counts only after a money-rules request, so `run` adds one before
// every other comment; `runWithoutRequest` leaves it out.
function runWithoutRequest(comments, reviewList = []) {
  return evaluateReviewers({
    comments,
    reviews: reviewList,
    head: HEAD,
    reviewers,
  });
}

function run(comments, reviewList = []) {
  return runWithoutRequest([codexRequest(0), ...comments], reviewList);
}

test('a SHA prefix matches only with at least seven characters', () => {
  assert.ok(shaMatchesHead(HEAD.slice(0, 7), HEAD));
  assert.ok(shaMatchesHead(HEAD.toUpperCase(), HEAD));
  assert.ok(!shaMatchesHead(HEAD.slice(0, 6), HEAD));
  assert.ok(!shaMatchesHead(OLD_HEAD.slice(0, 10), HEAD));
  assert.ok(!shaMatchesHead('', HEAD));
});

test('verdict blocks parse, tolerate markdown and reject ambiguity', () => {
  assert.deepEqual(parseVerdictBlock(verdictBlock()), {
    verdict: 'PASS',
    head: HEAD,
    prompt: 'money-rules-adversarial-review/v1',
  });
  const bold = `**MONEY-RULES-VERDICT:** FAIL\n**REVIEWED-HEAD:** \`${HEAD}\`\n- PROMPT-VERSION: money-rules-adversarial-review/v1`;
  assert.equal(parseVerdictBlock(bold).verdict, 'FAIL');
  assert.equal(parseVerdictBlock('no verdict here'), null);
  assert.match(
    parseVerdictBlock(`${verdictBlock()}\n${verdictBlock({ verdict: 'FAIL' })}`)
      .error,
    /conflicting/
  );
  assert.match(
    parseVerdictBlock('MONEY-RULES-VERDICT: PASS').error,
    /REVIEWED-HEAD/
  );
  // The prompt's placeholder example never parses as a real verdict.
  assert.match(
    parseVerdictBlock(
      'MONEY-RULES-VERDICT: PASS or FAIL\nREVIEWED-HEAD: <full 40-character head SHA>'
    ).error,
    /PASS or FAIL|REVIEWED-HEAD/
  );
});

test('Codex plus Claude on the current head satisfies both families', () => {
  const result = run([codexClean(), claudeVerdict()]);
  assert.equal(result.satisfied, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.families.codex.state, 'pass');
  assert.equal(result.families.claude.state, 'pass');
});

test('only one reviewer family fails', () => {
  const codexOnly = run([codexClean()]);
  assert.equal(codexOnly.satisfied, false);
  assert.match(codexOnly.failures.join('\n'), /from claude:/i);
  const claudeOnly = run([claudeVerdict()]);
  assert.equal(claudeOnly.satisfied, false);
  assert.match(claudeOnly.failures.join('\n'), /codex/i);
});

test('verdicts on an old SHA do not count', () => {
  const result = run([codexClean(OLD_HEAD), claudeVerdict({ sha: OLD_HEAD })]);
  assert.equal(result.satisfied, false);
  assert.equal(result.families.codex.state, 'missing');
  assert.match(result.families.codex.detail, /fedcba9/);
  assert.equal(result.families.claude.state, 'missing');
});

test('a FAIL verdict, an old prompt version or an untrusted author does not count', () => {
  assert.equal(
    run([codexClean(), claudeVerdict({ verdict: 'FAIL' })]).families.claude
      .state,
    'fail'
  );
  assert.equal(
    run([
      codexClean(),
      claudeVerdict({ prompt: 'money-rules-adversarial-review/v0' }),
    ]).families.claude.state,
    'missing'
  );
  const impostor = comment(OWNER, verdictBlock(), 3);
  assert.equal(run([codexClean(), impostor]).satisfied, false);
  const fakeCodex = comment(OWNER, codexClean().body, 2);
  assert.equal(
    run([fakeCodex, claudeVerdict()]).families.codex.state,
    'missing'
  );
});

test('the latest verdict from a family wins, using its own edit time', () => {
  const failThenPass = [
    codexClean(),
    claudeVerdict({ verdict: 'FAIL' }, 3),
    claudeVerdict({}, 5),
  ];
  assert.equal(run(failThenPass).families.claude.state, 'pass');
  // claude-code-action edits its own tracking comment as it works.
  const edited = {
    ...claudeVerdict({}, 3),
    updatedAt: at(9),
    editor: CLAUDE,
    body: verdictBlock({ verdict: 'FAIL' }),
  };
  assert.equal(
    run([codexClean(), claudeVerdict({}, 5), edited]).families.claude.state,
    'fail'
  );
});

test('Codex findings on the head after its clean comment withdraw the clean verdict', () => {
  const findings = review(
    CODEX,
    '### Codex Review\n\n**Reviewed commit:** `0123456789`',
    HEAD,
    6
  );
  assert.equal(
    run([codexClean(HEAD, 2), claudeVerdict()], [findings]).families.codex
      .state,
    'fail'
  );
  const earlierFindings = review(CODEX, 'findings', HEAD, 1);
  assert.equal(
    run([codexClean(HEAD, 2), claudeVerdict()], [earlierFindings]).families
      .codex.state,
    'pass'
  );
  const oldHeadFindings = review(CODEX, 'findings', OLD_HEAD, 7);
  assert.equal(
    run([codexClean(HEAD, 2), claudeVerdict()], [oldHeadFindings]).families
      .codex.state,
    'pass'
  );
});

test('Codex quota or other non-clean comments are not verdicts', () => {
  const quota = comment(
    CODEX,
    'You have reached your Codex usage limits for code reviews.',
    2
  );
  assert.equal(run([quota, claudeVerdict()]).families.codex.state, 'missing');
});

test('Claude verdicts posted as review bodies also count', () => {
  const asReview = review(CLAUDE, verdictBlock(), HEAD, 3);
  assert.equal(run([codexClean()], [asReview]).families.claude.state, 'pass');
});

test('owner sign-off needs the owner login and the current head', () => {
  assert.equal(
    evaluateOwnerSignoff({
      comments: [ownerApproval()],
      head: HEAD,
      ownerSignoff,
    }).approved,
    true
  );
  const long = comment(OWNER, `Looks good.\n\nsummary-approved ${HEAD}\n`, 4);
  assert.equal(
    evaluateOwnerSignoff({ comments: [long], head: HEAD, ownerSignoff })
      .approved,
    true
  );
  const stale = evaluateOwnerSignoff({
    comments: [ownerApproval(OLD_HEAD)],
    head: HEAD,
    ownerSignoff,
  });
  assert.equal(stale.approved, false);
  assert.match(stale.detail, /fedcba9/);
  const stranger = evaluateOwnerSignoff({
    comments: [ownerApproval(HEAD, 'someone-else')],
    head: HEAD,
    ownerSignoff,
  });
  assert.equal(stranger.approved, false);
  const botNamedLikeOwner = { ...ownerApproval(), userType: 'Bot' };
  assert.equal(
    evaluateOwnerSignoff({
      comments: [botNamedLikeOwner],
      head: HEAD,
      ownerSignoff,
    }).approved,
    false
  );
  const quoted = comment(
    OWNER,
    `> summary-approved ${HEAD.slice(0, 7)}\nnot yet`,
    4
  );
  assert.equal(
    evaluateOwnerSignoff({ comments: [quoted], head: HEAD, ownerSignoff })
      .approved,
    false
  );
  assert.equal(
    evaluateOwnerSignoff({ comments: [], head: HEAD, ownerSignoff }).approved,
    false
  );
});

test('unresolved review threads are counted, outdated ones included', () => {
  assert.equal(countUnresolvedThreads([]), 0);
  assert.equal(
    countUnresolvedThreads([
      { isResolved: true },
      { isResolved: false },
      { isResolved: false, isOutdated: true },
    ]),
    2
  );
});

test('owner sign-off may also be given in a review body', () => {
  const approval = {
    ...review(OWNER, `summary-approved ${HEAD.slice(0, 7)}`, HEAD, 4),
    userType: 'User',
  };
  assert.equal(
    evaluateOwnerSignoff({
      comments: [],
      reviews: [approval],
      head: HEAD,
      ownerSignoff,
    }).approved,
    true
  );
  const botReview = { ...approval, userType: 'Bot' };
  assert.equal(
    evaluateOwnerSignoff({
      comments: [],
      reviews: [botReview],
      head: HEAD,
      ownerSignoff,
    }).approved,
    false
  );
});
