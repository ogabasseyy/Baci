import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

// Heavy workflows that still wait for ready_for_review. The two big ones follow review-first CI
// instead (ci.yml, checkout-browser.yml: see review-first-ci/ci-workflow-contract.test.mjs), and
// security.yml keeps scanning every push, drafts included (Semgrep SAST is a cheap required check).
const names = ['codeql', 'ios-runtime-scheduler-pr',
  'rn-find-shadow-node-gtest', 'pilot-codec-compatibility', 'chatwoot-synthetic-handoff', 'link-checker'];
const load = (name) => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
function evaluate(condition, eventName, draft) {
  const github = { event_name: eventName, event: { pull_request: { draft } } };
  // A draft must short-circuit before accessing job outputs or secrets.
  return Function('github', `return (${condition.replaceAll("labels.*.name", "labels")});`)(github);
}
for (const name of names) {
  test(`${name} starts on ready and skips every job for draft pushes`, () => {
    const workflow = load(name);
    assert.ok(workflow.on.pull_request.types.includes('synchronize'));
    assert.ok(workflow.on.pull_request.types.includes('ready_for_review'));
    for (const [id, job] of Object.entries(workflow.jobs)) {
      assert.equal(evaluate(job.if, 'pull_request', true), false, id);
    }
  });
}
test('main CI no longer depends on the draft flag or on ready_for_review', () => {
  const workflow = load('ci');
  // The capability-gate contract forbids any `types:` filter on ci.yml's pull_request trigger.
  assert.equal('types' in workflow.on.pull_request, false);
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.doesNotMatch(String(job.if ?? ''), /\.draft/, id);
  }
  // Heavy jobs wait for the review-first stage instead (full contract: review-first-ci tests).
  assert.match(workflow.jobs['quality-test'].if, /needs\.changes\.outputs\.stage == 'full'/);
  assert.match(workflow.jobs.quality.if, /always\(\)/);
});
test('security scans and Semgrep SAST run on every push, drafts included', () => {
  const workflow = load('security');
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.doesNotMatch(String(job.if ?? ''), /\.draft/, id);
  }
});
test('Muse reviews draft pushes and retains same-repository isolation', () => {
  const workflow = load('muse-code-review');
  assert.ok(workflow.on.pull_request_target.types.includes('synchronize'));
  assert.ok(workflow.on.pull_request_target.types.includes('converted_to_draft'));
  assert.match(workflow.jobs['muse-review'].if, /draft == true/);
  assert.match(workflow.jobs['muse-review'].if, /head.repo.full_name == github.repository/);
});
