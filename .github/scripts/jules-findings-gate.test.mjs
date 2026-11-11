import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { PR_HEAD_SHA, reviewStep, runWorkflowStep, stepEnv } from './jules-workflow.test-helpers.mjs';

const workflow = YAML.parse(readFileSync('.github/workflows/jules-pr-review.yml', 'utf8'));
const gate = workflow.jobs.review.steps.find((step) => step.name === 'Gate on Jules findings').run;

test('the extracted filter is pinned and checkout keeps no credentials', () => {
  const steps = workflow.jobs.review.steps;
  const index = steps.findIndex((step) => step.name === 'Checkout findings filter');
  assert.ok(index >= 0 && index < steps.findIndex((step) => step.name === 'Gate on Jules findings'));
  assert.equal(steps[index].with['persist-credentials'], false);
  assert.equal(steps[index].with.ref, '${{ github.sha }}');
  assert.match(gate, /sha256sum/);
  assert.match(gate, /awk -f/);
  assert.match(gate, /git show "\$\{WORKFLOW_COMMIT_SHA\}:/);
  assert.match(steps[index].if, /needs_filter/);
});

test('submission-only fallback cannot masquerade as a produced review', () => {
  const submit = workflow.jobs.review.steps.find((step) => step.name === 'Submit Jules review').run;
  assert.match(submit, /body_file="\$RUNNER_TEMP\/jules-review-submit-fallback\.md"/);
});

test('preflight avoids checkout for unavailable reviews and bypassed gates', () => {
  const preflight = workflow.jobs.review.steps.find((step) => step.id === 'findings_preflight').run;
  for (const [body, labels, expected] of [[false, '[]', 'false'], [true, '[]', 'true'], [true, '[{"name":"bypass-ai-gate"}]', 'false']]) {
    const dir = mkdtempSync(join(tmpdir(), 'jules-preflight-'));
    try {
      if (body) writeFileSync(join(dir, 'jules-review.md'), 'Review');
      const output = join(dir, 'output');
      const result = spawnSync('bash', ['-c', preflight], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, PR_LABELS: labels } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `needs_filter=${expected}\n`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

function runGate(body, { committedFilter = readFileSync('.github/scripts/filter-jules-findings.awk'), worktreeFilter = null, reviewedSha = 'event' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jules-gate-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.github/scripts'), { recursive: true });
    const filter = join(repo, '.github/scripts/filter-jules-findings.awk');
    for (const args of [['init', '-q'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'event']]) {
      const git = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    const eventSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    writeFileSync(filter, committedFilter);
    for (const args of [['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'workflow']]) {
      const git = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    const workflowSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    if (worktreeFilter !== null) writeFileSync(filter, worktreeFilter);
    if (body !== null) writeFileSync(join(dir, 'jules-review.md'), body);
    if (reviewedSha !== null) writeFileSync(join(dir, 'jules-review-meta.env'), `REVIEWED_SHA=${reviewedSha === 'event' ? eventSha : reviewedSha}\n`);
    return spawnSync('bash', ['-c', gate], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, PR_LABELS: '[]', EVENT_HEAD_SHA: eventSha, WORKFLOW_COMMIT_SHA: workflowSha },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('rejects altered committed filter and ignores hostile worktree changes', () => {
  const hostile = 'BEGIN { print "hostile execution"; exit 0 }\n';
  const rejected = runGate('- **High:** Credentials leak.', { committedFilter: hostile });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /digest mismatch/);
  assert.doesNotMatch(rejected.stdout, /hostile execution/);
  const protectedRun = runGate('- **High:** Credentials leak.', { worktreeFilter: hostile });
  assert.equal(protectedRun.status, 1);
  assert.match(protectedRun.stdout, /Jules flagged findings/);
});

test('a review of a different or missing revision cannot pass the gate', () => {
  for (const reviewedSha of ['b'.repeat(40), null, 'invalid']) {
    const result = runGate('No findings.', { reviewedSha });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /reviewed revision/);
  }
});

const clean = `## Findings
- **High:** No high-severity issues found.
- **Medium:** No medium-severity issues found.
- **Low:** No low-severity issues found.
`;

test('accepts the exact clean severity statements Jules returned', () => {
  assert.equal(runGate(clean).status, 0);
  assert.equal(runGate(`${clean}\n## Suggested next steps\n- Proceed.`).status, 0);
  assert.equal(runGate(`${clean}\n## Suggested next steps\n- Proceed.`.replaceAll('\n', '  \r\n')).status, 0);
  assert.equal(runGate('I found no high-severity issues.').status, 0);
});

test('still blocks real findings, including contradictions and appended text', () => {
  for (const body of [
    '- **High:** Sensitive credentials leak.',
    '- Medium: An authorization check is missing.',
    `${clean}- **Low:** A real defect exists.`,
    '- **High:** No high-severity issues found. However, credentials leak.',
    '- **High:** No high-severity issues found.\n  However, credentials leak.',
    '- **High:** No high-severity issues found.\n\n  However, credentials leak.',
    '- **High:** No high-severity issues found.  \r\n\r\n  However, credentials leak.',
    '- **High:** No high-severity issues found.\nHowever, credentials leak.',
    '- **High:** No medium-severity issues found.',
    `${clean}\n## Suggested next steps\n- **High:** Credentials leak.`,
    'I have reviewed the pull request. However, I found a high-severity issue where the script is unsafe.',
    '- I found a high-severity security vulnerability in auth.ts.',
    'I found two high-severity issues in auth.ts.',
  ]) {
    const result = runGate(body);
    assert.equal(result.status, 1, body);
    assert.match(result.stdout, /::error::Jules flagged findings/, body);
  }
});

test('retains existing advisory behavior when the review body is absent', () => {
  assert.equal(runGate(null).status, 0);
});

const LATER_SHA = 'b'.repeat(40);
const fromBot = (body) => ({ user: { login: 'github-actions[bot]' }, body });
const submit = (options = {}) => runWorkflowStep(reviewStep('Submit Jules review').run, { env: { REVIEW_MODE: 'fast' }, ...options });

test('the no-review-body notice is posted once per pull request, not on every push', () => {
  const first = submit();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.posts.length, 1);
  assert.match(first.posts[0].body, /did not produce a review body/);
  assert.match(first.posts[0].body, /once per pull request and review mode/);
  assert.equal(first.posts[0].commit_id, PR_HEAD_SHA);

  const laterPush = submit({ headSha: LATER_SHA, reviews: [fromBot(first.posts[0].body)] });
  assert.equal(laterPush.status, 0, laterPush.stderr);
  assert.equal(laterPush.posts.length, 0);
});

test('a notice from someone else, or from the other review mode, does not hide the notice', () => {
  const notice = submit().posts[0].body;
  for (const reviews of [[{ user: { login: 'someone' }, body: notice }], [fromBot(notice.replace('mode:fast', 'mode:deep'))]]) {
    const result = submit({ headSha: LATER_SHA, reviews });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.posts.length, 1);
  }
});

test('a produced review is still posted once per commit after a notice', () => {
  const notice = submit().posts[0].body;
  const review = `<!-- jules-pr-review mode:fast sha:${LATER_SHA} -->\n## Jules PR review\n\nReal review.`;
  const runnerFiles = { 'jules-review.md': review, 'jules-review-meta.env': `REVIEWED_SHA=${LATER_SHA}\n` };
  const posted = submit({ headSha: LATER_SHA, reviews: [fromBot(notice)], runnerFiles });
  assert.equal(posted.status, 0, posted.stderr);
  assert.equal(posted.posts.length, 1);
  assert.match(posted.posts[0].body, /Real review\./);
  assert.equal(posted.posts[0].commit_id, LATER_SHA);

  const rerun = submit({ headSha: LATER_SHA, reviews: [fromBot(notice), fromBot(review)], runnerFiles });
  assert.equal(rerun.posts.length, 0);
});

test('a Jules run that produced no review passes the gate as incomplete instead of being read as a finding', () => {
  const step = reviewStep('Run Jules review');
  const env = stepEnv(step, { EVENT_NAME: 'pull_request', REVIEW_MODE: 'fast', HEAD_SHA: PR_HEAD_SHA, PR_LABELS: '[]', COMMENT_BODY: '', COMMENT_AUTHOR_ASSOC: '' });
  const failed = [{ createTime: '2026-11-11T00:00:00Z', sessionFailed: { reason: 'Quota exhausted' } }];
  const bodies = [];
  for (const [julesState, activities, expected] of [
    ['IN_PROGRESS', [], /did not finish within the workflow polling window/],
    ['COMPLETED', [], /did not return a final review message/],
    ['FAILED', failed, /Quota exhausted/],
    ['AWAITING_USER_FEEDBACK', [], /manual intervention/],
    ['PAUSED', [], /manual intervention/],
  ]) {
    const body = runWorkflowStep(step.run, { env, julesState, activities, sleepScale: 100 }).runnerFile('jules-review.md');
    assert.match(body, expected, julesState);
    assert.match(body, /incomplete, not clean/, julesState);
    bodies.push(body);
  }

  // One gate pass over all five: none of them may read as a finding.
  const result = runGate(bodies.join('\n\n'));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Jules review passed/);
});
