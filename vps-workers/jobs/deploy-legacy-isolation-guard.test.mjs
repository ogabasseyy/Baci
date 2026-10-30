import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prepare = readFileSync(
  new URL('../lib/prepare-worker-release.sh', import.meta.url),
  'utf8'
);

test('legacy deploy.sh refuses a host migrated to isolated worker releases before staging', () => {
  const body = prepare.slice(prepare.indexOf('prepare_worker_release() {'));
  const guard = body.indexOf('[ -e /srv/baci-worker/current ]');
  const firstMutation = body.indexOf('STAGING_DIR=');

  assert.ok(guard > 0, 'the isolated-release guard is missing');
  assert.ok(
    guard < firstMutation,
    'the guard must run before the release is staged'
  );
  assert.match(body, /Refusing legacy worker deployment[^\n]*\n\s+exit 1/);
});
