// The newest qualifying verdict overall decides, and requests and answers are
// ordered by last-edit time.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE,
  claudeRequest,
  claudeVerdict,
  codexClean,
  codexRequest,
  comment,
  editedAt,
  HEAD,
  loadRawConfig,
  OLD_HEAD,
  OWNER,
  verdictBlock,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import { evaluateReviewers } from './money-pr-assurance-reviews.mjs';

const { reviewers } = parseAssuranceConfig(loadRawConfig());
const run = (comments) =>
  evaluateReviewers({ comments, reviews: [], head: HEAD, reviewers }).families;

test('Codex: an older head clean plus a newer clean for another commit is missing', () => {
  const { codex } = run([
    codexRequest(1),
    codexClean(HEAD, 2),
    codexClean(OLD_HEAD, 3),
  ]);
  assert.equal(codex.state, 'missing');
  assert.match(codex.detail, /latest clean verdict was for/);
});

test('Codex: a newer head clean passes over an older clean for another commit', () => {
  const { codex } = run([
    codexRequest(1),
    codexClean(OLD_HEAD, 2),
    codexClean(HEAD, 3),
  ]);
  assert.equal(codex.state, 'pass');
});

test('Codex: a clean edited after the request counts by its edit time only if it follows it', () => {
  const edited = editedAt(codexClean(HEAD, 2), 5, codexClean().login);
  assert.equal(run([codexRequest(3), edited]).codex.state, 'pass');
  assert.equal(run([codexRequest(6), edited]).codex.state, 'missing');
});

test('verdict family: an older head PASS plus a newer verdict for another commit is missing', () => {
  const { claude } = run([
    claudeRequest(1),
    claudeVerdict({}, 2),
    claudeVerdict({ sha: OLD_HEAD }, 3),
  ]);
  assert.equal(claude.state, 'missing');
  assert.match(claude.detail, /latest verdict was for/);
});

test('verdict family: a newer head PASS passes over an older verdict for another commit', () => {
  const { claude } = run([
    claudeRequest(1),
    claudeVerdict({ sha: OLD_HEAD, verdict: 'FAIL' }, 2),
    claudeVerdict({}, 3),
  ]);
  assert.equal(claude.state, 'pass');
});

test('verdict family: a request edited after the answer invalidates it', () => {
  const edited = editedAt(claudeRequest(1), 5, OWNER);
  assert.equal(run([edited, claudeVerdict({}, 3)]).claude.state, 'missing');
});

test('verdict family: an answer is ordered by its edit time, not creation', () => {
  const answer = comment(
    CLAUDE,
    `Review\n\n${verdictBlock({})}\n`,
    1,
    { id: 1900 }
  );
  const edited = editedAt(answer, 5, CLAUDE);
  // Created before the request but rewritten after it.
  assert.equal(run([claudeRequest(3), edited]).claude.state, 'pass');
  assert.equal(run([claudeRequest(3), answer]).claude.state, 'missing');
});
