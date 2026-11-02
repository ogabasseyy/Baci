// Reviewer verdicts must come from the reviewer itself: an edit by another
// login, a Codex review nobody asked to use the money-rules prompt, or a
// verdict posted under the shared GitHub Actions identity never counts.
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
  PROMPT_PATH,
  review,
  verdictBlock,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  evaluateOwnerSignoff,
  evaluateReviewers,
} from './money-pr-assurance-reviews.mjs';

const raw = loadRawConfig();
const { reviewers, ownerSignoff } = parseAssuranceConfig(raw);

function run(comments, reviewList = [], config = reviewers) {
  return evaluateReviewers({
    comments,
    reviews: reviewList,
    head: HEAD,
    reviewers: config,
  });
}

test('a claude[bot] verdict edited by the owner login does not count', () => {
  const forged = {
    ...claudeVerdict({ verdict: 'FAIL' }, 3),
    body: verdictBlock(),
    updatedAt: at(8),
    editor: OWNER,
  };
  const result = run([codexRequest(), codexClean(), forged]);
  assert.equal(result.families.claude.state, 'fail');
  assert.match(result.families.claude.detail, /edited by ogabasseyy/);
  assert.equal(result.satisfied, false);
});

test('blanking or rewriting a newer verdict does not let an older PASS win', () => {
  const blanked = {
    ...claudeVerdict({ verdict: 'FAIL' }, 5),
    body: 'Nothing to see.',
    updatedAt: at(8),
    editor: OWNER,
  };
  const result = run([
    codexRequest(),
    codexClean(),
    claudeVerdict({}, 3),
    blanked,
  ]);
  assert.equal(result.families.claude.state, 'fail');
  // A fresh verdict from Claude after the tampered comment counts again.
  const fresh = run([
    codexRequest(),
    codexClean(),
    blanked,
    claudeVerdict({}, 9),
  ]);
  assert.equal(fresh.families.claude.state, 'pass');
});

test('a Codex clean comment edited by another login does not count', () => {
  const rewritten = { ...codexClean(OLD_HEAD, 2), editor: OWNER };
  rewritten.body = codexClean(HEAD).body;
  const result = run([codexRequest(), rewritten, claudeVerdict()]);
  assert.equal(result.families.codex.state, 'missing');
});

test('an item whose editor could not be read does not count', () => {
  const unknown = { ...claudeVerdict(), editor: undefined };
  assert.equal(
    run([codexRequest(), codexClean(), unknown]).families.claude.state,
    'fail'
  );
});

test('an owner sign-off edited by another login does not count', () => {
  const edited = { ...ownerApproval(), editor: CLAUDE };
  assert.equal(
    evaluateOwnerSignoff({ comments: [edited], head: HEAD, ownerSignoff })
      .approved,
    false
  );
  const ownEdit = { ...ownerApproval(), editor: OWNER };
  assert.equal(
    evaluateOwnerSignoff({ comments: [ownEdit], head: HEAD, ownerSignoff })
      .approved,
    true
  );
});

test("Codex's automatic review without a money-rules request does not count", () => {
  const result = run([codexClean(), claudeVerdict()]);
  assert.equal(result.families.codex.state, 'missing');
  assert.match(result.families.codex.detail, /money-rules prompt/);
  assert.match(result.families.codex.detail, new RegExp(PROMPT_PATH));
});

test('a money-rules request before the clean comment on the head counts', () => {
  assert.equal(
    run([codexRequest(1), codexClean(HEAD, 2), claudeVerdict()]).families.codex
      .state,
    'pass'
  );
  // Codex's automatic review of the same head may land between the request
  // and the requested review.
  const raced = run([
    codexRequest(1),
    codexClean(HEAD, 2),
    { ...codexClean(HEAD, 4), id: 1104, nodeId: 'IC_1104' },
    claudeVerdict(),
  ]);
  assert.equal(raced.families.codex.state, 'pass');
});

test('a request made for an earlier head does not cover a later clean comment', () => {
  const result = run([
    codexRequest(1),
    codexClean(OLD_HEAD, 2),
    codexClean(HEAD, 5),
    claudeVerdict({}, 6),
  ]);
  assert.equal(result.families.codex.state, 'missing');
  const afterFindings = run(
    [codexRequest(1), codexClean(HEAD, 5), claudeVerdict({}, 6)],
    [review(CODEX, 'findings', OLD_HEAD, 3)]
  );
  assert.equal(afterFindings.families.codex.state, 'missing');
});

test('requests count only from the owner login, unedited and naming the prompt', () => {
  const stranger = codexRequest(1, 'someone-else');
  assert.equal(
    run([stranger, codexClean(), claudeVerdict()]).families.codex.state,
    'missing'
  );
  const bare = comment(OWNER, '@codex review', 1, { id: 3001 });
  assert.equal(
    run([bare, codexClean(), claudeVerdict()]).families.codex.state,
    'missing'
  );
  const edited = { ...codexRequest(1), editor: CLAUDE };
  assert.equal(
    run([edited, codexClean(), claudeVerdict()]).families.codex.state,
    'missing'
  );
  const late = codexRequest(3);
  assert.equal(
    run([codexClean(HEAD, 2), late, claudeVerdict()]).families.codex.state,
    'missing'
  );
});

test('Codex findings are compared with when its clean comment was created', () => {
  const touched = { ...codexClean(HEAD, 2), updatedAt: at(9), editor: CODEX };
  const findings = review(CODEX, 'findings', HEAD, 6);
  assert.equal(
    run([codexRequest(1), touched, claudeVerdict()], [findings]).families.codex
      .state,
    'fail'
  );
});

test('the committed groups are Codex and Claude; a GitHub Actions verdict never counts', () => {
  assert.deepEqual(reviewers.groups, [['codex'], ['claude']]);
  const marker = `<!-- gemini-code-review sha:${HEAD} -->`;
  const actions = review(
    'github-actions[bot]',
    `${marker}\n${verdictBlock()}`,
    HEAD,
    3
  );
  assert.equal(run([codexRequest(), codexClean()], [actions]).satisfied, false);
});

test('a marker family counts only when its body starts with the marker', () => {
  const withMarker = parseAssuranceConfig({
    ...raw,
    reviewers: {
      ...raw.reviewers,
      groups: [['codex'], ['claude', 'marked']],
      families: {
        ...raw.reviewers.families,
        marked: {
          kind: 'verdict-block',
          logins: ['marked-reviewer[bot]'],
          requiredMarker: '<!-- marked-review sha:{head} -->',
        },
      },
    },
  }).reviewers;
  const marker = `<!-- marked-review sha:${HEAD} -->`;
  const leading = review(
    'marked-reviewer[bot]',
    `${marker}\n${verdictBlock()}`,
    HEAD,
    3
  );
  const buried = review(
    'marked-reviewer[bot]',
    `## Output\n${marker}\n${verdictBlock()}`,
    HEAD,
    3
  );
  const base = [codexRequest(), codexClean()];
  assert.equal(run(base, [leading], withMarker).satisfied, true);
  assert.equal(run(base, [buried], withMarker).satisfied, false);
});
