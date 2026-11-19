import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const comment = (review, overrides = {}) => {
  const time = overrides.updated_at ?? '2026-11-19T05:00:00Z';
  return {
    user: { id: 199175422, type: 'Bot' },
    performed_via_github_app: { id: 1144995 },
    updated_at: time,
    body: `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: review })} -->\n| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="${time}">${time}</relative-time> |`,
    ...overrides,
  };
};

test('requires an actual completed clean review of the current commit', () => {
  assert.equal(classifyCodexReview([], head), 'pending');
  assert.equal(classifyCodexReview([comment(code())], head), 'clean');
  assert.equal(classifyCodexReview([comment(code({ commit_sha: previous }))], head), 'stale');
  assert.equal(classifyCodexReview([comment(code({ status: 'in_progress' }))], head), 'pending');
  assert.equal(classifyCodexReview([comment(code({ has_unresolved_findings: null }))], head), 'unavailable');
  assert.equal(
    classifyCodexReview([comment(code(), { updated_at: '2026-11-19T03:00:00Z' })], head, {
      invalidatedAt: '2026-11-19T04:00:00Z',
    }),
    'stale'
  );
  assert.equal(
    classifyCodexReview([comment(code(), { updated_at: '2026-11-19T05:00:00Z' })], head, {
      invalidatedAt: '2026-11-19T04:00:00Z',
    }),
    'clean'
  );
});

test('treats any-findings summaries as non-clean unless both finding flags are false', () => {
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: true, has_unresolved_findings: true }))], head), 'findings');
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: true, has_unresolved_findings: false }))], head), 'findings');
  assert.equal(classifyCodexReview([comment(code({ has_any_findings: false, has_unresolved_findings: true }))], head), 'unavailable');
});

test('keeps workflow BOT_USER_ID synchronized with codex-review-evidence.mjs', () => {
  const workflow = readFileSync('.github/workflows/codex-review-evidence.yml', 'utf8');
  const script = readFileSync('.github/scripts/codex-review-evidence.mjs', 'utf8');
  const scriptBotId = script.match(/const BOT_USER_ID = (\d+);/)?.[1];
  assert.ok(scriptBotId);
  assert.ok(workflow.includes(`id != ${scriptBotId}`));
  assert.ok(workflow.includes(`id == ${scriptBotId}`));
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

test('requires fresh code-review timestamp after retargeting and fails closed on later quota notices', () => {
  const preRetargetCodeWithLaterSecurityEdit = comment(code(), {
    updated_at: '2026-11-19T06:00:00Z',
    body: `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: code() })} -->\n| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-11-19T04:00:00Z">2026-11-19T04:00:00Z</relative-time> |\n| 🔒 **Security Review** | ✅ **Completed** <relative-time datetime="2026-11-19T06:00:00Z">2026-11-19T06:00:00Z</relative-time> |`,
  });
  assert.equal(
    classifyCodexReview([preRetargetCodeWithLaterSecurityEdit], head, { invalidatedAt: '2026-11-19T05:00:00Z' }),
    'stale'
  );
  assert.equal(
    classifyCodexReview([comment(code())], head, { invalidatedAt: '2026-11-19T04:30:00Z' }),
    'clean'
  );
  const quotaNotice = {
    id: 2,
    user: { id: 199175422, type: 'Bot' },
    performed_via_github_app: { id: 1144995 },
    created_at: '2026-11-19T05:10:00Z',
    body: 'You have reached your Codex usage limits for this repository.',
  };
  assert.equal(classifyCodexReview([comment(code()), quotaNotice], head), 'unavailable');
});
