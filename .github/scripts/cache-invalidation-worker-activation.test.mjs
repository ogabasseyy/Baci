import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = readFileSync(
  fileURLToPath(new URL('./cache-invalidation-worker-activation.sh', import.meta.url)),
  'utf8'
);
const scopeProbe = readFileSync(
  fileURLToPath(new URL('./probe-cache-invalidation-hook-scope.sh', import.meta.url)),
  'utf8'
);
const capabilityProbe = readFileSync(
  fileURLToPath(new URL('./probe-cache-invalidation-worker-capability.sh', import.meta.url)),
  'utf8'
);

test('activation requires the unanimous read-only scope probe before the exact membership grant', () => {
  const scopeProbeIndex = script.indexOf('probe-cache-invalidation-hook-scope.sh');
  const grantIndex = script.indexOf('if serialized_membership_change; then');
  const capabilityProbeIndex = script.indexOf(
    'probe-cache-invalidation-worker-capability.sh'
  );
  assert.ok(scopeProbeIndex >= 0);
  assert.ok(grantIndex > scopeProbeIndex);
  assert.ok(capabilityProbeIndex > grantIndex);
  assert.match(scopeProbe, /UNANIMITY_S="\$\{CACHE_WORKER_PROBE_UNANIMITY_S:-300\}"/);
  assert.match(scopeProbe, /CACHE INVALIDATION hook reload canary observed/);
  assert.match(capabilityProbe, /has_cache_invalidation_dead_letters/);
  assert.match(capabilityProbe, /products\?select=id/);
});

test('failed post-grant verification preserves membership instead of misattributing another operator grant', () => {
  assert.match(
    script,
    /if ! "\$SCRIPT_DIR\/probe-cache-invalidation-worker-capability\.sh"; then[\s\S]*?membership state was left unchanged/
  );
  const failedProbeBranch = script.match(/if ! "\$SCRIPT_DIR\/probe-cache-invalidation-worker-capability\.sh"; then([\s\S]*?)\n  fi/);
  assert.ok(failedProbeBranch);
  assert.doesNotMatch(failedProbeBranch[1], /REVOKE|serialized_membership_change/);
  assert.match(script, /Usage: \$0 activate/);
});

test('ambiguous Management API grant outcomes are reconciled before activation proceeds', () => {
  assert.match(script, /if serialized_membership_change; then/);
  assert.match(
    script,
    /after_state="\$\(membership_state\)"[\s\S]*?Grant response was ambiguous/
  );
  assert.match(script, /Grant response and membership reconciliation are ambiguous/);
});

test('the only membership transition is a serialized grant; role revocation is absent', () => {
  assert.match(script, /pg_advisory_xact_lock\(20261028, 41\)/);
  assert.match(script, /serialized_membership_change\(\)/);
  assert.match(script, /GRANT cache_invalidation_worker TO authenticator/);
  assert.doesNotMatch(script, /REVOKE|rollback\(\)/);
  assert.match(script, /does not claim to lock[\s\S]*?multi-minute probes/);
});

test('activation is pinned, narrow, and does not print secrets', () => {
  assert.match(script, /EXPECTED_PROJECT_REF=aivqthbxdshhltbwipbr/);
  assert.match(script, /GRANT cache_invalidation_worker TO authenticator/);
  assert.match(script, /chmod 0600 "\$ACTIVATION_CONFIG"/);
  assert.match(script, /node "\$SCRIPT_DIR\/production-release-lock\.mjs" authorize-cache-worker-action/);
  assert.ok(script.indexOf('authorize-cache-worker-action') < script.indexOf('management_query()'));
  assert.doesNotMatch(script, /echo\s+.*SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(script, /echo\s+.*\$SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(script, /echo\s+.*\$CACHE_INVALIDATION_WORKER_TOKEN/);
  assert.doesNotMatch(script, /echo\s+.*\$body/);
});

test('rollback action is rejected before authorization or external mutation', () => {
  const result = spawnSync('bash', [
    fileURLToPath(new URL('./cache-invalidation-worker-activation.sh', import.meta.url)),
    'rollback',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /membership revocation is unsupported/);
  assert.doesNotMatch(result.stdout + result.stderr, /Management API|membership was revoked/);
  assert.ok(script.indexOf('*) usage ;;') < script.indexOf('authorize-cache-worker-action'));
});

test('the release capability probe requires a successful allowlist RPC and explicit out-of-scope denial', () => {
  assert.match(capabilityProbe, /CACHE_INVALIDATION_WORKER_TOKEN/);
  assert.match(capabilityProbe, /has_cache_invalidation_dead_letters/);
  assert.match(capabilityProbe, /Cache invalidation worker request is outside its capability scope/);
  assert.match(capabilityProbe, /do not deploy the cache drain route/);
});
