import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createDbForwarder, SSL_REQUEST } from './piggyvest-db-forwarder.mjs';
import {
  cleanups,
  client,
  noop,
  runCleanups,
  startFakeUpstream,
  startForwarder,
  until,
} from './piggyvest-db-forwarder-test-support.mjs';

afterEach(runCleanups);

describe('piggyvest db forwarder limits and timeouts', () => {
  it('enforces the global connection cap', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { maxConnections: 2, maxPerSource: 10 },
    });
    const a = client(port);
    const b = client(port);
    a.socket.write(SSL_REQUEST);
    b.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 2);
    const c = client(port);
    await c.closed;
    assert.equal(forwarder.stats().rejected.global_cap, 1);
    assert.equal(upstream.connections.length, 2);
    // Capacity frees up once a connection closes.
    a.socket.destroy();
    await until(() => forwarder.stats().active === 1);
    const d = client(port);
    d.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 3);
  });

  it('enforces the per-source cap', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { maxConnections: 60, maxPerSource: 2 },
    });
    const a = client(port);
    const b = client(port);
    a.socket.write(SSL_REQUEST);
    b.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 2);
    const c = client(port);
    await c.closed;
    assert.equal(forwarder.stats().rejected.source_cap, 1);
    assert.equal(upstream.connections.length, 2);
  });

  it('closes clients that send nothing within the first-bytes timeout', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { firstBytesTimeoutMs: 100 },
    });
    const c = client(port);
    await c.closed;
    assert.equal(forwarder.stats().rejected.first_bytes_timeout, 1);
    assert.equal(upstream.connections.length, 0);
  });

  it('closes clients that send a partial SSLRequest and stall', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { firstBytesTimeoutMs: 100 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST.subarray(0, 4));
    await c.closed;
    assert.equal(forwarder.stats().rejected.first_bytes_timeout, 1);
    assert.equal(upstream.connections.length, 0);
  });

  it('times out a stalled upstream connect', async () => {
    // A backlog-1 listener that never accepts, saturated, makes SYNs hang on
    // some hosts; a non-routable address is not reliable offline. Use a lookup
    // that never resolves instead.
    const forwarder = createDbForwarder({
      listenPort: 0,
      listenHost: '127.0.0.1',
      upstream: {
        host: 'blackhole.invalid',
        port: 5432,
        family: 4,
        lookup: noop,
      },
      limits: { connectTimeoutMs: 100 },
    });
    const port = await forwarder.listen();
    cleanups.push(() => forwarder.close());
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await c.closed;
    assert.equal(forwarder.stats().rejected.connect_timeout, 1);
  });
});
