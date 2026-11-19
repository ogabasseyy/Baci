import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
  call,
  listen,
  startRelay,
} from './piggyvest-egress-relay-test-support.mjs';

describe('piggyvest egress relay server failure modes', () => {
  it('turns an upstream timeout into 504 maybe-sent', async () => {
    const { relayPort } = await startRelay({
      upstreamHandler: () => undefined, // never answers
      limits: { upstreamTimeoutMs: 60 },
    });
    const res = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body: '{}',
    });
    assert.equal(res.status, 504);
    assert.equal(res.headers['x-baci-relay-error'], 'upstream_timeout');
    assert.equal(res.headers['x-baci-relay-upstream'], 'maybe-sent');
  });

  it('marks a connection reset after the request was written as maybe-sent', async () => {
    const { relayPort } = await startRelay({
      upstreamHandler: (req) => req.socket.destroy(),
    });
    const res = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body: '{}',
    });
    assert.equal(res.status, 502);
    assert.equal(res.headers['x-baci-relay-error'], 'upstream_connection_lost');
    assert.equal(res.headers['x-baci-relay-upstream'], 'maybe-sent');
  });

  it('marks an unreachable upstream as not-sent', async () => {
    const closed = createServer();
    const closedPort = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const { relayPort } = await startRelay({ upstreamPort: closedPort });
    const res = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body: '{}',
    });
    assert.equal(res.status, 502);
    assert.equal(res.headers['x-baci-relay-error'], 'upstream_unreachable');
    assert.equal(res.headers['x-baci-relay-upstream'], 'not-sent');
  });

  it('never follows redirects', async () => {
    let followed = 0;
    const elsewhere = createServer((_req, res) => {
      followed += 1;
      res.end('{}');
    });
    const elsewherePort = await listen(elsewhere);
    const { relayPort } = await startRelay({
      upstreamHandler: (_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${elsewherePort}/x` });
        res.end();
      },
    });
    const res = await call(relayPort, { target: '/api/v1/wallet/w1' });
    assert.equal(res.status, 502);
    assert.equal(res.headers['x-baci-relay-error'], 'upstream_redirect');
    assert.equal(res.headers.location, undefined);
    assert.equal(followed, 0);
  });

  it('caps request and response sizes', async () => {
    const { relayPort, seen } = await startRelay({
      upstreamHandler: (_req, res) => res.end('x'.repeat(5000)),
      limits: { maxRequestBytes: 100, maxResponseBytes: 1000 },
    });
    const big = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body: 'y'.repeat(200),
    });
    assert.equal(big.status, 413);
    assert.equal(seen.length, 0);
    const huge = await call(relayPort, { target: '/api/v1/wallet/w1' });
    assert.equal(huge.status, 502);
    assert.equal(huge.headers['x-baci-relay-error'], 'response_too_large');
    assert.equal(huge.headers['x-baci-relay-upstream'], 'maybe-sent');
  });

  it('returns 413, not a reset, for a chunked body over the limit', async () => {
    const { relayPort, seen } = await startRelay({
      upstreamHandler: (_req, res) => res.end('{}'),
      limits: { maxRequestBytes: 100 },
    });
    const res = await call(relayPort, {
      method: 'POST',
      target: '/api/v1/transfer/wallet',
      body: 'y'.repeat(200),
      headers: { 'transfer-encoding': 'chunked' },
    });
    assert.equal(res.status, 413);
    assert.equal(res.headers['x-baci-relay-error'], 'request_too_large');
    assert.equal(res.headers['x-baci-relay-upstream'], 'not-sent');
    assert.equal(seen.length, 0);
  });
});
