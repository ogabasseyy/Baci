import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CODEX_LOGIN,
  collectEvidence,
  evidenceFromIssueComment,
  evidenceFromReview,
  evidenceFromReviewComment,
  isCodexAuthor,
} from './codex-evidence.mjs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const summaryClean = load('codex-summary-clean.json');
const summaryFindings = load('codex-summary-findings.json');
const summaryCleanAfterFix = load('codex-summary-clean-after-fix.json');
const receiptClean = load('codex-receipt-clean.json');
const [reviewFindings] = load('codex-review-findings.json');
const inlineFinding = load('codex-inline-finding.json');

const comment = (body, overrides = {}) => ({
  id: 1,
  user: { login: CODEX_LOGIN, type: 'Bot' },
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
  body,
  ...overrides,
});

const state = (codeReview, version = 1) =>
  `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v${version} ${JSON.stringify({ code_review: codeReview, security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } })} -->\nsummary`;

describe('isCodexAuthor', () => {
  it('accepts only the Codex connector bot', () => {
    assert.equal(isCodexAuthor({ login: CODEX_LOGIN, type: 'Bot' }), true);
    assert.equal(isCodexAuthor({ login: 'ogabasseyy', type: 'User' }), false);
    assert.equal(isCodexAuthor({ login: 'chatgpt-codex-connector', type: 'User' }), false);
    assert.equal(isCodexAuthor(null), false);
  });
});

describe('real Codex summary comment (codex-review-state:v1)', () => {
  it('reads a completed review without findings as clean for the full commit', () => {
    const [item] = evidenceFromIssueComment(summaryClean).evidence;
    assert.equal(item.kind, 'clean');
    assert.equal(item.sha, 'd9df294247dc5e1aa215e269ad96aa3c2eeb8ca5');
    assert.equal(item.time, summaryClean.updated_at);
  });

  it('reads the same summary after the fix commit as clean for the NEW commit only', () => {
    const [item] = evidenceFromIssueComment(summaryCleanAfterFix).evidence;
    assert.equal(item.kind, 'clean');
    assert.equal(item.sha, '33d8a3b086a5c501701a9000b04b97091148c553');
  });

  it('reads a completed review with unresolved findings as findings, not clean', () => {
    const [item] = evidenceFromIssueComment(summaryFindings).evidence;
    assert.equal(item.kind, 'findings');
    assert.equal(item.sha, 'c00e55a83a988b1122b9cbe714ddb93dc60e6813');
  });

  it('ignores a summary that has no code review yet (security review only)', () => {
    const body = state({ commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null });
    assert.deepEqual(evidenceFromIssueComment(comment(body)).evidence, []);
  });

  it('reports a running review as running', () => {
    const body = state({ commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: 'running' });
    const [item] = evidenceFromIssueComment(comment(body)).evidence;
    assert.equal(item.kind, 'running');
    assert.equal(item.sha, null);
  });

  it('treats findings that were all resolved as findings (conservative: needs a fresh Codex pass or ci-now)', () => {
    const body = state({ commit_sha: 'a'.repeat(40), has_any_findings: true, has_unresolved_findings: false, status: 'completed' });
    const [item] = evidenceFromIssueComment(comment(body)).evidence;
    assert.equal(item.kind, 'findings');
  });

  it('fails closed on a completed review whose findings flags are null', () => {
    const body = state({ commit_sha: 'a'.repeat(40), has_any_findings: null, has_unresolved_findings: null, status: 'completed' });
    const result = evidenceFromIssueComment(comment(body));
    assert.deepEqual(result.evidence, []);
    assert.equal(result.unrecognized.length, 1);
  });

  it('refuses a clean state that carries no full commit sha', () => {
    const body = state({ commit_sha: 'abc123', has_any_findings: false, has_unresolved_findings: false, status: 'completed' });
    const result = evidenceFromIssueComment(comment(body));
    assert.deepEqual(result.evidence, []);
    assert.equal(result.unrecognized.length, 1);
  });

  it('flags an unknown state version instead of trusting it', () => {
    const body = state({ commit_sha: 'a'.repeat(40), has_any_findings: false, has_unresolved_findings: false, status: 'completed' }, 2);
    const result = evidenceFromIssueComment(comment(body));
    assert.deepEqual(result.evidence, []);
    assert.match(result.unrecognized[0], /codex-review-state:v2/);
  });

  it('flags malformed state JSON', () => {
    const body = '<!-- codex-review-state:v1 {not json} -->';
    const result = evidenceFromIssueComment(comment(body));
    assert.deepEqual(result.evidence, []);
    assert.equal(result.unrecognized.length, 1);
  });
});

describe('real Codex clean receipt comment (codex-review-receipt:v1)', () => {
  it('reads "Didn\'t find any major issues" with the abbreviated reviewed commit', () => {
    const [item] = evidenceFromIssueComment(receiptClean).evidence;
    assert.equal(item.kind, 'clean');
    assert.equal(item.sha, '256f2d6bf4');
    assert.equal(item.time, receiptClean.created_at);
  });

  it('accepts the older text-only clean verdict without the receipt marker', () => {
    const body = "Codex Review: Didn't find any major issues. 🚀\n**Reviewed commit:** `63e12ea2bf`";
    const [item] = evidenceFromIssueComment(comment(body)).evidence;
    assert.equal(item.kind, 'clean');
    assert.equal(item.sha, '63e12ea2bf');
  });

  it('does not treat the receipt marker alone as clean', () => {
    const body = '<!-- codex-review-receipt:v1 -->\n\nHere are some automated review suggestions\n**Reviewed commit:** `c00e55a83a`';
    assert.deepEqual(evidenceFromIssueComment(comment(body)).evidence, []);
  });

  it('flags a clean phrase with no reviewed commit', () => {
    const result = evidenceFromIssueComment(comment("Codex Review: Didn't find any major issues."));
    assert.deepEqual(result.evidence, []);
    assert.equal(result.unrecognized.length, 1);
  });

  it('flags an unknown receipt version', () => {
    const body = "<!-- codex-review-receipt:v2 -->\nDidn't find any major issues\n**Reviewed commit:** `63e12ea2bf`";
    const result = evidenceFromIssueComment(comment(body));
    assert.deepEqual(result.evidence, []);
    assert.match(result.unrecognized[0], /codex-review-receipt:v2/);
  });

  it('records a usage-limit notice as unavailable', () => {
    const body = 'You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.';
    const [item] = evidenceFromIssueComment(comment(body)).evidence;
    assert.equal(item.kind, 'unavailable');
  });
});

describe('bugfix: a Codex comment in a format nobody has seen is reported, never read as a verdict', () => {
  const taskStyle = comment('## Review Result\n\nNo actionable findings. The throwaway workflow is narrowly scoped.\n\n**Checks**\n* git diff --check');

  it('is not clean, but is listed so the run can warn loudly', () => {
    const result = evidenceFromIssueComment(taskStyle);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.unrecognized.length, 1);
    assert.match(result.unrecognized[0], /unknown format/);
    assert.match(result.unrecognized[0], /Review Result/);
  });

  it('does not report the usage-limit notice or the clean receipt as unknown', () => {
    assert.deepEqual(evidenceFromIssueComment(comment('You have reached your Codex usage limits for code reviews.')).unrecognized, []);
    assert.deepEqual(evidenceFromIssueComment(receiptClean).unrecognized, []);
  });

  it('keeps only the newest few unknown items when collecting', () => {
    const many = Array.from({ length: 6 }, (_, index) => comment(`## Review Result ${index}`, { id: 100 + index }));
    assert.equal(collectEvidence({ issueComments: many }).unrecognized.length, 2);
  });
});

describe('authorship', () => {
  it('ignores clean-looking text from anyone but the Codex bot', () => {
    const human = comment("Didn't find any major issues\n**Reviewed commit:** `63e12ea2bf`", {
      user: { login: 'ogabasseyy', type: 'User' },
    });
    assert.deepEqual(evidenceFromIssueComment(human).evidence, []);
    const lookalike = comment("Didn't find any major issues\n**Reviewed commit:** `63e12ea2bf`", {
      user: { login: 'chatgpt-codex-connector', type: 'User' },
    });
    assert.deepEqual(evidenceFromIssueComment(lookalike).evidence, []);
  });
});

describe('findings arrive as reviews and inline comments', () => {
  it('reads the real Codex findings review (receipt marker plus suggestions) as findings on its commit', () => {
    const [item] = evidenceFromReview(reviewFindings).evidence;
    assert.equal(item.kind, 'findings');
    assert.equal(item.sha, 'c00e55a83a');
    assert.equal(item.time, reviewFindings.submitted_at);
  });

  it('reads a clean review body as clean', () => {
    const review = { ...reviewFindings, body: "<!-- codex-review-receipt:v1 -->\nDidn't find any major issues.\n**Reviewed commit:** `c00e55a83a`" };
    assert.equal(evidenceFromReview(review).evidence[0].kind, 'clean');
  });

  it('reads a badge-only review body as findings on the review commit', () => {
    const review = { ...reviewFindings, body: '![P2 Badge](https://img.shields.io/badge/P2-yellow) something' };
    const [item] = evidenceFromReview(review).evidence;
    assert.equal(item.kind, 'findings');
    assert.equal(item.sha, reviewFindings.commit_id);
  });

  it('ignores the empty-bodied wrapper review that carries inline comments', () => {
    assert.deepEqual(evidenceFromReview({ ...reviewFindings, body: '' }).evidence, []);
  });

  it('reads the real inline finding as findings on the commit it was written against', () => {
    const [item] = evidenceFromReviewComment(inlineFinding).evidence;
    assert.equal(item.kind, 'findings');
    assert.equal(item.sha, inlineFinding.original_commit_id);
    assert.notEqual(item.sha, inlineFinding.commit_id);
  });

  it('collects marked Codex findings posted as thread replies', () => {
    const [finding] = evidenceFromReviewComment({ ...inlineFinding, in_reply_to_id: 42 }).evidence;
    assert.equal(finding.kind, 'findings');
    assert.equal(finding.sha, inlineFinding.original_commit_id);
  });

  it('ignores inline comments from other authors', () => {
    const other = { ...inlineFinding, user: { login: 'ogabasseyy', type: 'User' } };
    assert.deepEqual(evidenceFromReviewComment(other).evidence, []);
  });
});

describe('collectEvidence', () => {
  it('gathers evidence from every source, oldest first', () => {
    const { evidence, unrecognized } = collectEvidence({
      issueComments: [summaryFindings, receiptClean],
      reviews: [reviewFindings],
      reviewComments: [inlineFinding],
    });
    assert.deepEqual(unrecognized, []);
    assert.equal(evidence.length, 4);
    const times = evidence.map((item) => Date.parse(item.time));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it('handles missing lists', () => {
    assert.deepEqual(collectEvidence({}), { evidence: [], unrecognized: [] });
  });
});
