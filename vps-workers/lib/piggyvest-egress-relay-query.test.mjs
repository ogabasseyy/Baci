import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchAllowlistedTarget } from './piggyvest-egress-relay-allowlist.mjs';
import {
  call,
  NOW_SECONDS,
  ok,
  startRelay,
} from './piggyvest-egress-relay-test-support.mjs';

const listing = '/api/v1/transaction';
const match = (target) => matchAllowlistedTarget('GET', target)?.template;

describe('allowlist query handling', () => {
  it('accepts opaque cursors URLSearchParams encodes', () => {
    const cursor = new URLSearchParams({ cursor: 'ab/c+d==%x' }).toString();
    assert.match(cursor, /%2F/);
    assert.match(cursor, /%25/);
    assert.equal(match(`${listing}?wallet_id=w&${cursor}`), listing);
    assert.equal(match(`${listing}?cursor=a%2Eb..c%2e%2e`), listing);
  });

  it('still rejects traversal and encoded separators in the pathname', () => {
    assert.equal(match('/api/v1/wallet/a%2Fb?x=1'), undefined);
    assert.equal(match('/api/v1/wallet/../customers?x=1'), undefined);
    assert.equal(match('/api/v1/wallet/%2e%2e/x'), undefined);
    assert.equal(match('/api/v1/wallet/a%25'), undefined);
  });

  it('rejects NUL, CR/LF, malformed escapes and unknown keys in the query', () => {
    for (const query of [
      'cursor=a%00b',
      'cursor=a%0d%0aX',
      'cursor=a%0Ab',
      'cursor=a\r\nb',
      'cursor=a%zz',
      'cursor=a%2',
      'cursor=café',
      'evil=1',
    ]) {
      assert.equal(match(`${listing}?${query}`), undefined, query);
    }
  });
});

describe('relay forwards signed query bytes untouched', () => {
  it('forwards a cursor exactly as signed', async () => {
    const { relayPort, seen } = await startRelay({ upstreamHandler: ok });
    const target = `${listing}?wallet_id=w1&cursor=ab%2Fc%2Bd%3D%3D%25x`;
    const res = await call(relayPort, { target });
    assert.equal(res.status, 200);
    assert.equal(seen[0].url, target);
  });
});

describe('restart replay guard', () => {
  it('rejects a request signed before the process started', async () => {
    const { relayPort, seen } = await startRelay({
      upstreamHandler: ok,
      nowMs: (NOW_SECONDS + 10) * 1000,
    });
    const res = await call(relayPort, {
      target: '/api/v1/wallet/w1',
      timestamp: NOW_SECONDS + 5,
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-baci-relay-error'], 'auth_predates_start');
    assert.equal(res.headers['x-baci-relay-upstream'], 'not-sent');
    assert.equal(seen.length, 0);
  });

  it('accepts a request signed after start', async () => {
    const { relayPort, seen } = await startRelay({
      upstreamHandler: ok,
      nowMs: (NOW_SECONDS + 10) * 1000,
    });
    const res = await call(relayPort, {
      target: '/api/v1/wallet/w1',
      timestamp: NOW_SECONDS + 10,
    });
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
  });

  it('does not forward the same signed request again after a restart', async () => {
    const first = await startRelay({ upstreamHandler: ok });
    const nonce = 'ab'.repeat(16);
    const target = '/api/v1/transfer/wallet';
    const send = (relayPort) =>
      call(relayPort, { method: 'POST', target, body: '{}', nonce });
    assert.equal((await send(first.relayPort)).status, 200);
    assert.equal(first.seen.length, 1);

    const restarted = await startRelay({
      upstreamHandler: ok,
      nowMs: (NOW_SECONDS + 5) * 1000,
    });
    const replay = await send(restarted.relayPort);
    assert.equal(replay.status, 401);
    assert.equal(replay.headers['x-baci-relay-error'], 'auth_predates_start');
    assert.equal(restarted.seen.length, 0);
  });
});
