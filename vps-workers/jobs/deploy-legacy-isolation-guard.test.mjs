import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const prepare = read('../lib/prepare-worker-release.sh');
const guards = read('../lib/check-deploy-workflow-inflight.sh');

test('legacy deploy.sh refuses a host migrated to isolated worker releases before staging', () => {
  const body = prepare.slice(prepare.indexOf('prepare_worker_release() {'));
  const guard = body.indexOf('refuse_isolated_worker_host');
  const firstMutation = body.indexOf('STAGING_DIR=');

  assert.ok(guard > 0, 'the isolated-release guard is not called');
  assert.ok(
    guard < firstMutation,
    'the guard must run before the release is staged'
  );
  const fn = guards.slice(guards.indexOf('refuse_isolated_worker_host() {'));
  assert.match(fn, /\[ -e \/srv\/baci-worker\/current \]/);
  assert.match(fn, /Refusing legacy worker deployment[^\n]*\n\s+return 1/);
  assert.match(body, /refuse_isolated_worker_host \|\| exit 1/);
  // bugfix: a failed probe must refuse instead of reading as "not migrated".
  assert.match(fn, /if ! host_layout="\$\(ssh /);
  assert.match(fn, /if \[ "\$host_layout" != legacy \]/);
});
