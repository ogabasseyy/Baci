import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHostedAccess } from './hosted-access-check.mjs';

function response(status, headers = {}) {
  return new Response(null, { status, headers });
}

test('checks only fixed staging GET and OPTIONS routes without credentials or redirects', async () => {
  const calls = [];
  const results = [
    response(401),
    response(403),
    response(403),
    response(404),
    response(204, {
      'access-control-allow-origin': 'https://staging.ogabassey.com',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type',
      vary: 'Origin',
    }),
    response(403),
  ];
  const result = await checkHostedAccess((url, options) => {
    calls.push({ url, options });
    return results.shift();
  });
  assert.equal(result.accessChecksPassed, true);
  assert.equal(result.financialEndToEndVerified, false);
  assert.equal(calls.length, 6);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, 'https://staging-auth.ogabassey.com');
    assert.ok(['GET', 'OPTIONS'].includes(options.method));
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
  }
});

test('network failures remain unavailable and never expose error details', async () => {
  const result = await checkHostedAccess(() => {
    throw new Error('sensitive-network-detail');
  });
  assert.equal(result.accessChecksPassed, false);
  assert.ok(
    result.checks.every((check) => check.status === null && !check.passed)
  );
  assert.doesNotMatch(JSON.stringify(result), /sensitive/);
});

test('wildcard CORS, credentials and missing method coverage never pass', async () => {
  for (const headers of [
    { 'access-control-allow-origin': '*' },
    {
      'access-control-allow-origin': 'https://staging.ogabassey.com',
      'access-control-allow-credentials': 'true',
    },
    {
      'access-control-allow-origin': 'https://staging.ogabassey.com',
      'access-control-allow-methods': 'GET',
    },
  ]) {
    const result = await checkHostedAccess(async () => response(204, headers));
    assert.equal(
      result.checks.find((check) => check.name === 'draft-preflight').passed,
      false
    );
  }
});

test('an unavailable backend and redirects do not count as authenticated denial', async () => {
  for (const status of [200, 301, 502, 503]) {
    const result = await checkHostedAccess(async () => response(status));
    assert.equal(result.accessChecksPassed, false);
    assert.equal(result.checks[0].passed, false);
  }
});
