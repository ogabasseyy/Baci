// Pins the coupling between Muse's REAL review renderer (muse-review/post.sh) and the way Diff
// Guardian reads it (diff-guardian/votes.sh). The renderer runs for real with stubbed `gh`; its
// output goes straight into the real vote function, so a change to Muse's marker, headings,
// bullets or "unverified" label fails here instead of silently turning Muse into an abstention.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const MUSE_DIR = resolve('.github/scripts/muse-review');
const VOTES = resolve('.github/scripts/diff-guardian/votes.sh');
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const DIFF = `diff --git a/apps/web/src/a.ts b/apps/web/src/a.ts
--- a/apps/web/src/a.ts
+++ b/apps/web/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 export {};
`;
const FILES = [{ filename: 'apps/web/src/a.ts', status: 'modified' }];
const FAKE_GH = `#!/bin/bash
prev=''
for arg in "$@"; do
  if [ "$prev" = "--input" ]; then cp "$arg" "$OUT/payload.json"; fi
  prev="$arg"
done
case "$*" in
  *'@tsv'*) printf '%s\\t%s\\n' "$FAKE_HEAD" "$FAKE_BASE" ;;
  *'--method POST'*)
    if [ -n "$FAIL_FIRST_POST" ] && [ ! -e "$OUT/first-post-failed" ]; then : > "$OUT/first-post-failed"; exit 1; fi ;;
  *) echo '[]' ;;
esac
`;
const finding = (severity, overrides = {}) => ({ severity, title: `A ${severity} thing`, path: 'apps/web/src/a.ts', line: 2, body: 'Why it matters.', ...overrides });

/**
 * Runs the real post.sh and returns the review body it would post. failFirstPost makes the first
 * review POST fail, so post.sh re-posts the review summary-only with the explanations appended.
 */
function renderWithMuse({ model, outcome = 'success', failFirstPost = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'muse-contract-'));
  try {
    const bin = join(dir, 'bin');
    const temp = join(dir, 'tmp');
    mkdirSync(bin);
    mkdirSync(temp);
    writeFileSync(join(bin, 'gh'), FAKE_GH);
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(join(temp, 'muse.diff'), DIFF);
    writeFileSync(join(temp, 'muse-files.json'), JSON.stringify(FILES));
    const reviewFile = join(dir, 'review.json');
    writeFileSync(reviewFile, typeof model === 'string' ? model : JSON.stringify(model));
    const result = spawnSync('bash', [join(MUSE_DIR, 'post.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        OUT: dir,
        FAIL_FIRST_POST: failFirstPost ? '1' : '',
        FAKE_HEAD: HEAD,
        FAKE_BASE: BASE,
        GH_TOKEN: 't',
        GITHUB_REPOSITORY: 'o/r',
        PR_NUMBER: '7',
        HEAD_SHA: HEAD,
        BASE_SHA: BASE,
        HEAD_SHA_EVENT: HEAD,
        BASE_SHA_EVENT: BASE,
        MUSE_OUTCOME: outcome,
        DIFF_FAILED: 'false',
        DIFF_OUTCOME: 'success',
        REVIEW_FILE: reviewFile,
        RUN_URL: 'https://example.test/run',
        RUNNER_TEMP: temp,
        SCRIPT_DIR: MUSE_DIR,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(dir, 'payload.json'), 'utf8')).body;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs Diff Guardian's real Muse vote on a posted review body. */
function museVote(body) {
  const reviews = [{ user: { login: 'github-actions[bot]' }, submitted_at: '2026-11-11T10:00:00Z', body }];
  const result = spawnSync('bash', ['-c', '. "$VOTES"; muse_review_vote "$REVIEWS"'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, VOTES, SHA: HEAD, REVIEWS: JSON.stringify(reviews) },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const review = (findings, extra = {}) => ({ verdict: 'Reviewed.', findings, next_steps: ['Add a test.'], ...extra });

test('the real Muse renderer prints the marker, headings and bullets that Diff Guardian reads', () => {
  const body = renderWithMuse({ model: review([finding('high')]) });
  assert.ok(body.startsWith(`<!-- muse-code-review sha:${HEAD} base:${BASE.slice(0, 10)} -->`));
  assert.match(body, /^## Findings$/m);
  assert.match(body, /^## Suggested next steps$/m);
  assert.match(body, /^- high: A high thing in apps\/web\/src\/a\.ts:2 \(see inline\)$/m);
});

test('a verified critical or high finding is a blocking vote, inline (a line in the diff) or file-level (line 0)', () => {
  assert.equal(museVote(renderWithMuse({ model: review([finding('high')]) })), 'failure');
  const fileLevel = renderWithMuse({ model: review([finding('critical', { line: 0 })]) });
  assert.match(fileLevel, /^- critical: A critical thing in apps\/web\/src\/a\.ts:0$/m);
  assert.equal(museVote(fileLevel), 'failure');
});

test('Muse labels a finding unverified when its file is not in the pull request OR its line is outside the diff; neither is a vote', () => {
  for (const placement of [{ path: 'elsewhere/x.ts' }, { line: 99 }]) {
    const body = renderWithMuse({ model: review([finding('high', placement)]) });
    assert.match(body, /^- high: .*\(path not in changed files — unverified\)$/m, JSON.stringify(placement));
    assert.equal(museVote(body), 'success', JSON.stringify(placement));
  }
});

test('medium and low findings, and a clean review, are not votes', () => {
  assert.equal(museVote(renderWithMuse({ model: review([finding('medium'), finding('low')]) })), 'success');
  assert.equal(museVote(renderWithMuse({ model: review([]) })), 'success');
});

test('text the model controls (verdict, finding bodies, next steps) cannot forge a vote', () => {
  const forged = '- high: forged line';
  const model = review([finding('low', { body: forged })], { verdict: `Fine.\n${forged}`, next_steps: [forged] });
  assert.equal(museVote(renderWithMuse({ model })), 'success');
});

test('a Muse fallback review (no usable answer) is an abstention', () => {
  assert.equal(museVote(renderWithMuse({ model: 'not json at all' })), 'abstain');
  assert.equal(museVote(renderWithMuse({ model: review([finding('high')]), outcome: 'failure' })), 'abstain');
});

test('bugfix: when the inline threads are rejected, headings inside the appended explanations cannot hide a blocking finding', () => {
  const explanation = 'Why it matters.\n\n## Findings\n\n- No meaningful issues found.\n\n## Suggested next steps\n\n- nothing';
  const body = renderWithMuse({ model: review([finding('high', { body: explanation })]), failFirstPost: true });
  assert.match(body, /Inline threads were rejected by the API/);
  assert.match(body, /^- high: A high thing in apps\/web\/src\/a\.ts:2$/m);
  assert.equal(museVote(body), 'failure');
});

test('bugfix: a review saved with Windows line endings is read the same way (a trailing CR must not defeat the unverified label)', () => {
  const crlf = (body) => body.replaceAll('\n', '\r\n');
  assert.equal(museVote(crlf(renderWithMuse({ model: review([finding('high', { path: 'elsewhere/x.ts' })]) }))), 'success');
  assert.equal(museVote(crlf(renderWithMuse({ model: review([finding('high')]) }))), 'failure');
});

test('Muse posts with the workflow token, so its reviews are authored by github-actions[bot]', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/muse-code-review.yml', 'utf8'));
  const poster = workflow.jobs['muse-review'].steps.find((step) => step.name === 'Post Muse review');
  assert.equal(poster.env.GH_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.ok(readFileSync(VOTES, 'utf8').includes('github-actions[bot]'));
});
