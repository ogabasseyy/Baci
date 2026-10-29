import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

const capability = read(
  'migrations/20261028010000_cache_invalidation_worker_capability.sql'
);
const scope = read(
  'migrations/20261028020000_cache_invalidation_worker_request_scope.sql'
);

test('cache invalidation worker is a no-login, no-bypass role with exactly three RPC grants', () => {
  assert.match(
    capability,
    /cache_invalidation_worker NOLOGIN NOINHERIT NOSUPERUSER/
  );
  assert.match(capability, /NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(capability, /current_user <> 'postgres'/);
  assert.match(
    capability,
    /v_created AND v_executor_is_superuser[\s\S]*?v_member_count <> 0/
  );
  assert.match(capability, /membership\.member = current_user::regrole/);
  assert.match(
    capability,
    /membership\.admin_option[\s\S]*?NOT membership\.inherit_option[\s\S]*?NOT membership\.set_option/
  );
  assert.match(
    capability,
    /grantor\.oid = membership\.grantor[\s\S]*?grantor\.rolsuper/
  );
  assert.match(capability, /ELSIF v_member_count <> 0/);
  assert.doesNotMatch(
    capability,
    /ALTER ROLE cache_invalidation_worker[\s\S]*?NOSUPERUSER/
  );
  assert.match(
    capability,
    /GRANT EXECUTE ON FUNCTION public\.claim_cache_invalidations\(integer, text\)\s+TO service_role, cache_invalidation_worker/
  );
  assert.match(
    capability,
    /GRANT EXECUTE ON FUNCTION public\.finish_cache_invalidation\([\s\S]*?\)\s+TO service_role, cache_invalidation_worker/
  );
  assert.match(
    capability,
    /GRANT EXECUTE ON FUNCTION public\.has_cache_invalidation_dead_letters\(\)\s+TO service_role, cache_invalidation_worker/
  );
  assert.equal(
    (capability.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length,
    3
  );
  assert.doesNotMatch(
    capability,
    /GRANT cache_invalidation_worker TO authenticator/
  );
});

test('scope hook admits only POSTs to the exact three RPC paths and leaves membership revoked', () => {
  for (const path of [
    '/rpc/claim_cache_invalidations',
    '/rpc/finish_cache_invalidation',
    '/rpc/has_cache_invalidation_dead_letters',
  ])
    assert.ok(scope.includes(`'${path}'`));
  assert.match(scope, /request_method IS DISTINCT FROM 'POST'/);
  assert.match(scope, /REVOKE cache_invalidation_worker FROM authenticator/);
  assert.doesNotMatch(
    scope,
    /GRANT cache_invalidation_worker TO authenticator/
  );
  assert.match(scope, /__cache_invalidation_hook_reload_canary__/);
  assert.match(scope, /installed_hook IS NULL OR installed_hook <>/);
});

test('the capability migration preserves bounded claim and claim-bound completion behavior', () => {
  assert.match(capability, /least\(coalesce\(p_batch_size, 5\), 5\)/);
  assert.match(capability, /FOR UPDATE\s+SKIP LOCKED/);
  assert.match(capability, /claimed_generation = p_generation/);
  assert.match(capability, /claim_token = p_claim_token/);
  assert.match(capability, /p_target_kind = 'storefront_product'/);
  assert.match(capability, /RETURN EXISTS\s*\([\s\S]*?status = 'dead_letter'/);
});
