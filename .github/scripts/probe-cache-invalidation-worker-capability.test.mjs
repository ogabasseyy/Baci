import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = readFileSync(
  fileURLToPath(new URL('./probe-cache-invalidation-worker-capability.sh', import.meta.url)),
  'utf8'
);

test('cache worker preflight samples canary, allowed RPC, and forbidden path before release', () => {
  assert.match(script, /__cache_invalidation_hook_reload_canary__/);
  assert.match(script, /has_cache_invalidation_dead_letters/);
  assert.match(script, /products\?select=id/);
  assert.match(script, /Cache invalidation worker request is outside its capability scope/);
  assert.match(script, /UNANIMITY_S="\$\{CACHE_WORKER_PROBE_UNANIMITY_S:-300\}"/);
  assert.match(script, /Cache worker capability sample gate passed/);
});

test('cache worker preflight never prints token values or error response bodies', () => {
  assert.doesNotMatch(script, /echo\s+.*CACHE_INVALIDATION_WORKER_TOKEN/);
  assert.doesNotMatch(script, /echo\s+.*\$body/);
  assert.match(script, /do not deploy the cache drain route/);
});
