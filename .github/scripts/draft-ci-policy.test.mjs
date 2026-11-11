import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const names = ['checkout-browser', 'security', 'codeql', 'ios-runtime-scheduler-pr',
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
test('main CI admits ready PRs, main pushes, merge queues and manual runs', () => {
  const workflow = load('ci');
  assert.ok(workflow.on.pull_request.types.includes('ready_for_review'));
  const condition = workflow.jobs.changes.if;
  assert.equal(evaluate(condition, 'pull_request', true), false);
  for (const event of ['pull_request', 'push', 'merge_group', 'workflow_dispatch']) {
    assert.equal(evaluate(condition, event, false), true, event);
  }
  assert.match(workflow.jobs.quality.if, /always\(\)/);
});
test('Muse reviews draft pushes and retains same-repository isolation', () => {
  const workflow = load('muse-code-review');
  assert.ok(workflow.on.pull_request_target.types.includes('synchronize'));
  assert.ok(workflow.on.pull_request_target.types.includes('converted_to_draft'));
  assert.match(workflow.jobs['muse-review'].if, /draft == true/);
  assert.match(workflow.jobs['muse-review'].if, /head.repo.full_name == github.repository/);
});
