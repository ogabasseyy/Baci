import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  call,
  NOW_SECONDS,
  ok,
  PV_KEY,
  SECRET,
  startRelay,
} from './piggyvest-egress-relay-test-support.mjs';

describe('piggyvest egress relay server', () => {
  it('refuses everything when no secret is configured', async () => {
    const { relayPort, seen } = await startRelay({
      upstreamHandler: ok,
      secret: '',
    });
    const res = await call(relayPort, { target: '/api/v1/wallet/w1' });
    assert.equal(res.status, 503);
    assert.equal(res.headers['x-baci-relay-error'], 'not_configured');
    assert.equal(res.headers['x-baci-relay-upstream'], 'not-sent');
    assert.equal(seen.length, 0);
  });

  it('rejects missing, bad, stale and replayed auth without contacting upstream', async () => {
    const { relayPort, seen } = await startRelay({ upstreamHandler: ok });
    const target = '/api/v1/wallet/w1';
    const missing = await call(relayPort, { target, sign: false });
    const bad = await call(relayPort, {
      target,
      sign: false,
      headers: {
        'x-baci-relay-auth': `v1.${NOW_SECONDS}.${'a'.repeat(32)}.${'b'.repeat(64)}`,
      },
    });
    const stale = await call(relayPort, {
      target,
      timestamp: NOW_SECONDS - 61,
    });
    assert.deepEqual(
      [missing.status, bad.status, stale.status],
      [401, 401, 401]
    );
    assert.equal(missing.headers['x-baci-relay-error'], 'auth_missing');
    assert.equal(bad.headers['x-baci-relay-error'], 'auth_bad_signature');
    assert.equal(stale.headers['x-baci-relay-error'], 'auth_stale');
    assert.equal(seen.length, 0);

    const nonce = 'c'.repeat(32);
    const first = await call(relayPort, { target, nonce });
    const replay = await call(relayPort, { target, nonce });
    assert.equal(first.status, 200);
    assert.equal(replay.status, 401);
    assert.equal(replay.headers['x-baci-relay-error'], 'auth_replay');
    assert.equal(seen.length, 1);
  });

  it('answers 404 without contacting upstream for non-allowlisted targets', async () => {
    const { relayPort, seen } = await startRelay({ upstreamHandler: ok });
    for (const target of [
      '/api/v1/transfer/test/funding',
      '/api/v1/wallet/..%2fx',
      '/other',
    ]) {
      const res = await call(relayPort, { method: 'POST', target });
      assert.equal(res.status, 404, target);
      assert.equal(res.headers['x-baci-relay-error'], 'not_allowlisted');
    }
    assert.equal(seen.length, 0);
  });

  it('forwards credentials and body, strips relay and hop-by-hop headers, and tags the response', async () => {
    const { relayPort, seen } = await startRelay({ upstreamHandler: ok });
    const body = '{"amount":500,"reference":"ref-1"}';
    const res = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
        cookie: 'session=abc',
        'x-baci-relay-extra': 'nope',
        'proxy-authorization': 'Basic zzz',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-baci-relay-upstream'], 'sent');
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(res.headers['x-baci-relay-error'], undefined);
    const [upstreamCall] = seen;
    assert.equal(upstreamCall.body, body);
    assert.equal(upstreamCall.url, '/api/v1/transfer/wallet');
    assert.equal(upstreamCall.headers.authorization, `Bearer ${PV_KEY}`);
    assert.equal(upstreamCall.headers['content-type'], 'application/json');
    for (const name of [
      'x-baci-relay-auth',
      'x-baci-relay-extra',
      'x-forwarded-for',
      'cookie',
      'proxy-authorization',
    ]) {
      assert.equal(upstreamCall.headers[name], undefined, name);
    }
  });

  it('passes upstream error statuses through unmarked so they stay provider answers', async () => {
    const { relayPort } = await startRelay({
      upstreamHandler: (_req, res) => {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"status":false,"message":"not found"}');
      },
    });
    const res = await call(relayPort, {
      target: '/api/v1/transaction/verify?reference=r1&wallet_id=w1',
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers['x-baci-relay-error'], undefined);
    assert.equal(res.headers['x-baci-relay-upstream'], 'sent');
  });

  it('logs only method, template, status and latency', async () => {
    const { relayPort, logs } = await startRelay({ upstreamHandler: ok });
    await call(relayPort, {
      method: 'POST',
      target: '/api/v1/customers?returnIfExist=true',
      body: '{"email":"secret-person@example.com"}',
    });
    await call(relayPort, {
      target: '/api/v1/wallet/wallet-id-123?x=secret-query',
      sign: false,
    });
    await call(relayPort, {
      target:
        '/api/v1/transaction/verify?reference=ref-secret&wallet_id=w-secret',
    });
    const text = logs.join('\n');
    assert.match(logs[0], /^POST \/api\/v1\/customers 200 \d+ms$/);
    assert.match(logs[1], /^GET - 401 \d+ms relay_error=auth_missing$/);
    for (const forbidden of [
      PV_KEY,
      SECRET,
      'secret-person',
      'wallet-id-123',
      'secret-query',
      'ref-secret',
      'w-secret',
      'returnIfExist',
      'Bearer',
    ]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
});
