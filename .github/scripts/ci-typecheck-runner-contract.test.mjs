import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs['quality-typecheck'];

function route({ privateRepo = true, enabled = 'true', typecheckEnabled = 'true', event = 'pull_request', head = 'owner/repo' } = {}, field = 'runs-on') {
  let source = job[field].slice(3, -2);
  const values = {
    'github.event.repository.private': privateRepo,
    'vars.BACI_PRIVATE_CI_ENABLED': enabled,
    'vars.BACI_PRIVATE_TYPECHECK_ENABLED': typecheckEnabled,
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

test('typecheck requires explicit private opt-in and trusted repository head', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.equal(route({}, 'timeout-minutes'), 30);
  for (const value of [{ privateRepo: false }, { privateRepo: null }, { enabled: '' }, { enabled: 'false' }, { typecheckEnabled: '' }, { typecheckEnabled: 'false' }, { head: 'other/fork' }, { head: '' }]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 15);
  }
  for (const event of ['push', 'merge_group', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  }
});

test('does not pass remote cache credentials to self-hosted typecheck', () => {
  const step = job.steps.find((item) => item.name === 'Run Typecheck');
  for (const name of ['TURBO_TOKEN', 'TURBO_TEAM']) {
    const expression = step.env[name];
    for (const [environment, expected] of [['self-hosted', ''], [null, ''], ['github-hosted', 'secret']]) {
      const source = expression.slice(3, -2).replaceAll('runner.environment', JSON.stringify(environment)).replaceAll(`secrets.${name}`, JSON.stringify('secret'));
      assert.match(source, /^[\s()'"\w=!&|\-]+$/);
      assert.equal(Function(`"use strict"; return (${source});`)(), expected);
    }
  }
});
