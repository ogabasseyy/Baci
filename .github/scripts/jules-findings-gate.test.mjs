import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

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
