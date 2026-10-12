import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionSyntheticAuth } from './provision-synthetic-auth.mjs';

const configuration = {
  secret: 'a'.repeat(64),
  issuer: 'https://staging-auth.ogabassey.com/auth/v1',
  now: 1800000000,
};
test('creates only two synthetic confirmed accounts and retains no passwords or tokens', async () => {
  const retained = [];
  let count = 0;
  const result = await provisionSyntheticAuth({
    ...configuration,
    retain: async (value) => retained.push(value),
    request: (path, init) => {
      assert.equal(path, '/admin/users');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.email_confirm, true);
      assert.ok(body.password.length >= 40);
      const jwt = JSON.parse(
        Buffer.from(init.headers.Authorization.split('.')[1], 'base64url')
      );
      assert.equal(jwt.exp - jwt.iat, 60);
      count++;
      return {
        ok: true,
        json: async () => ({
          id: `10000000-0000-4000-8000-00000000000${count}`,
          email: body.email,
          secret: 'discard',
        }),
      };
    },
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result, retained);
  assert.deepEqual(Object.keys(result[0]), ['id', 'email']);
});
test('rejects production issuer before sending requests', async () => {
  await assert.rejects(
    provisionSyntheticAuth({
      ...configuration,
      issuer: 'https://production.invalid',
      request: () => assert.fail(),
      retain: () => assert.fail(),
    }),
    /Invalid isolated/
  );
});
test('never retries indeterminate creation or leaks request errors', async () => {
  let calls = 0;
  await assert.rejects(
    provisionSyntheticAuth({
      ...configuration,
      request: () => {
        calls++;
        throw new Error('SECRET');
      },
      retain: () => assert.fail(),
    }),
    /^Error: Synthetic Auth result indeterminate; reconcile before retry$/
  );
  assert.equal(calls, 1);
});
test('stops on rejected creation without reading sensitive error payloads', async () => {
  await assert.rejects(
    provisionSyntheticAuth({
      ...configuration,
      request: async () => ({
        ok: false,
        status: 422,
        json: () => assert.fail(),
      }),
      retain: () => assert.fail(),
    }),
    /rejected \(422\)/
  );
});
test('rejects a mismatched returned identity', async () => {
  await assert.rejects(
    provisionSyntheticAuth({
      ...configuration,
      request: async () => ({
        ok: true,
        json: async () => ({ id: 'bad', email: 'wrong' }),
      }),
      retain: () => assert.fail(),
    }),
    /identity mismatch/
  );
});
