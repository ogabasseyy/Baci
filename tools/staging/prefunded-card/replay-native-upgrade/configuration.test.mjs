import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConfiguration } from './configuration.mjs';
import { authority } from './constants.mjs';

function fixture() {
  const token = (role, aud) => ['header', Buffer.from(JSON.stringify({
    role, aud, iat: Math.floor(Date.now() / 1000) - 30, exp: authority.deadlineEpoch,
  })).toString('base64url'), 'synthetic-signature'].join('.');
  return {
    base: {
      environment: 'staging', appSystemId: authority.system,
      receiptSystemId: authority.receiptSystem,
      receiptKey: Buffer.alloc(32).toString('base64'),
      receiptToken: token('pvb_staging_worker', 'pvb-staging-receipts'),
      appToken: token('pvb_staging_app_worker', 'authenticated'),
      prefundedReplay: { bundleSha256: authority.predecessors.bundle,
        configurationSha256: authority.predecessors.private },
    },
    private: { scope: { ...authority.scope }, evidence: { syntheticSecret: 'fixture' },
      database: { treasury: { syntheticLogin: 'fixture' }, ingestion: { syntheticLogin: 'fixture' } } },
  };
}
function prepare(value) {
  return prepareConfiguration({ baseBytes: Buffer.from(JSON.stringify(value.base)),
    privateBytes: Buffer.from(JSON.stringify(value.private)), newBundleSha256: 'c'.repeat(64) });
}

test('preserves the installed six-field scope and every credential/profile byte value', () => {
  const value = fixture();
  const result = prepare(value);
  const changed = JSON.parse(result['config.json']);
  assert.deepEqual(changed, { ...value.base, prefundedReplay: {
    bundleSha256: 'c'.repeat(64), configurationSha256: authority.predecessors.private,
  } });
  assert.equal(result['prefunded.json'].toString(), JSON.stringify(value.private));
  assert.deepEqual(Object.keys(value.private.scope).sort(), Object.keys(authority.scope).sort());
});

test('refuses absent scope, expiry/batch extras, alias identities and other configuration changes', () => {
  for (const patch of [{ expiresAt: authority.deadline }, { batchSize: 1 }, { businessId: 'guess' }]) {
    const value = fixture();
    Object.assign(value.private.scope, patch);
    assert.throws(() => prepare(value), /configuration/);
  }
  const missing = fixture();
  delete missing.private.scope;
  assert.throws(() => prepare(missing), /configuration/);
  const extra = fixture();
  extra.base.financialDatabase = {};
  assert.throws(() => prepare(extra), /configuration/);
});

test('does not renew tokens, extend deadline or change role/audience identity', () => {
  for (const claims of [
    { role: 'service_role', aud: 'authenticated', exp: authority.deadlineEpoch },
    { role: 'pvb_staging_app_worker', aud: 'other', exp: authority.deadlineEpoch },
    { role: 'pvb_staging_app_worker', aud: 'authenticated', exp: authority.deadlineEpoch + 1 },
    { role: 'pvb_staging_app_worker', aud: 'authenticated', exp: 1 },
  ]) {
    const value = fixture();
    value.base.appToken = ['header', Buffer.from(JSON.stringify({
      iat: Math.floor(Date.now() / 1000) - 30, ...claims,
    })).toString('base64url'), 'synthetic-signature'].join('.');
    assert.throws(() => prepare(value), /configuration/);
  }
});
