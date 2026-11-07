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
  assert.equal(route({ event: 'merge_group', head: '' }), 'ubuntu-24.04');
  assert.equal(route({ event: 'merge_group', head: '' }, 'timeout-minutes'), 15);
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  }
});

test('typecheck job does not reference secrets', () => {
  const noSecrets = (value) => assert.doesNotMatch(JSON.stringify(value), /\bsecrets\b/);
  assert.throws(() => noSecrets('${{ toJSON(secrets) }}'));
  assert.doesNotThrow(() => noSecrets('not_secrets'));
  noSecrets(job);
});
