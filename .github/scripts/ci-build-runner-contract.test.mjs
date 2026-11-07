import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs.build;

function route({ privateRepo = true, enabled = 'true', buildEnabled = 'true', event = 'pull_request', head = 'owner/repo' } = {}, field = 'runs-on') {
  let source = job[field].slice(3, -2);
  const values = {
    'github.event.repository.private': privateRepo,
    'vars.BACI_PRIVATE_CI_ENABLED': enabled,
    'vars.BACI_PRIVATE_BUILD_ENABLED': buildEnabled,
    'github.event_name': event,
    'github.event.pull_request.head.repo.full_name': head,
    'github.repository': 'owner/repo',
  };
  for (const [key, value] of Object.entries(values)) {
    source = source.replace(new RegExp(`${key.replaceAll('.', '\\.')}(?![\\w.])`, 'g'), JSON.stringify(value));
  }
  source = source.replace(/fromJSON\('([^']+)'\)/g, (_match, json) => JSON.stringify(JSON.parse(json)));
  assert.match(source, /^[\s()'"\w=!&|,.[\]\/\-]+$/);
  return Function(`"use strict"; return (${source});`)();
}

test('build requires private opt-in and trusted non-merge-group source', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.equal(route({}, 'timeout-minutes'), 75);
  for (const value of [{ privateRepo: false }, { privateRepo: null }, { enabled: '' }, { enabled: 'false' }, { buildEnabled: '' }, { buildEnabled: 'false' }, { head: 'other/fork' }, { head: '' }, { event: 'merge_group', head: '' }]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 45);
  }
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  }
});

test('self-hosted build references no configured secrets and never runs hosted SDK deletion', () => {
  assert.doesNotMatch(JSON.stringify(job), /\bsecrets\b/);
  const reclaim = job.steps.find((step) => step.name === 'Reclaim unused hosted-runner SDK space');
  assert.match(reclaim.if, /runner\.environment\s*==\s*'github-hosted'/);
  assert.match(reclaim.run, /sudo rm -rf/);
  for (const environment of ['github-hosted', 'self-hosted', '']) {
    const condition = reclaim.if
      .replaceAll('runner.environment', JSON.stringify(environment))
      .replaceAll('needs.changes.outputs.web', "'true'")
      .replaceAll('needs.changes.outputs.test_plan_mode', "'full-affected'");
    assert.match(condition, /^[\s()'"\w=!&|.\-]+$/);
    assert.equal(Function(`"use strict"; return (${condition});`)(), environment === 'github-hosted');
  }
});
