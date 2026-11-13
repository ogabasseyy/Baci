import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCodexReview } from './codex-review-evidence.mjs';

const head = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const code = (overrides = {}) => ({
  commit_sha: head,
  status: 'completed',
  has_any_findings: false,
  has_unresolved_findings: false,
  ...overrides,
});
const comment = (review, overrides = {}) => ({
  user: { id: 199175422, type: 'Bot' },
  performed_via_github_app: { id: 1144995 },
  body: `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: review })} -->`,
  ...overrides,
});

test('requires an actual completed clean review of the current commit', () => {
  assert.equal(classifyCodexReview([], head), 'pending');
  assert.equal(classifyCodexReview([comment(code())], head), 'clean');
  assert.equal(classifyCodexReview([comment(code({ commit_sha: previous }))], head), 'stale');
  assert.equal(classifyCodexReview([comment(code({ status: 'in_progress' }))], head), 'pending');
  assert.equal(classifyCodexReview([comment(code({ has_unresolved_findings: null }))], head), 'unavailable');
});

test('distinguishes unresolved findings from reviewed and resolved findings', () => {
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: true, has_unresolved_findings: true }))], head), 'findings');
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: true, has_unresolved_findings: false }))], head), 'clean');
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: false, has_unresolved_findings: true }))], head), 'unavailable');
});

test('rejects spoofed, malformed or ambiguous summaries', () => {
  assert.equal(classifyCodexReview([comment(code(), { user: { id: 1, type: 'User' } })], head), 'pending');
  assert.equal(classifyCodexReview([comment(code(), { performed_via_github_app: { id: 1 } })], head), 'pending');
  assert.equal(classifyCodexReview([comment(code(), { body: '<!-- codex-review-state:v1 {broken} -->' })], head), 'unavailable');
  const good = comment(code());
  assert.equal(classifyCodexReview([{ ...good, body: `${good.body}\n${good.body}` }], head), 'ambiguous');
  assert.equal(classifyCodexReview([{ ...good, body: `${good.body}\ncodex-review-state:v1 invalid` }], head), 'ambiguous');
  assert.equal(classifyCodexReview([good, comment(code())], head), 'ambiguous');
  const duplicateKey = `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${head}","status":"completed","has_any_findings":true,"has_unresolved_findings":true,"has_unresolved_findings":false}} -->`;
  assert.equal(classifyCodexReview([comment(code(), { body: duplicateKey })], head), 'unavailable');
  assert.equal(classifyCodexReview([comment(code(), { body: good.body + 'x'.repeat(200_000) })], head), 'unavailable');
  assert.equal(classifyCodexReview([comment(code({ commit_sha: 'invalid' }))], head), 'unavailable');
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: 'false' }))], head), 'unavailable');
  assert.equal(classifyCodexReview([comment(code({ status: 'unexpected' }))], head), 'unavailable');
});

test('does not infer a code review from a security review or an invalid head', () => {
  const securityOnly = comment(code(), { body: `<!-- codex-review-state:v1 ${JSON.stringify({ security_review: code() })} -->` });
  assert.equal(classifyCodexReview([securityOnly], head), 'unavailable');
  assert.throws(() => classifyCodexReview([], 'bad-sha'));
});
