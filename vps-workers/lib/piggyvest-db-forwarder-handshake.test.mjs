import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createDbForwarder, SSL_REQUEST } from './piggyvest-db-forwarder.mjs';
import {
  client,
  pause,
  runCleanups,
  startFakeUpstream,
  startForwarder,
  startScripted,
  until,
} from './piggyvest-db-forwarder-test-support.mjs';

afterEach(runCleanups);

describe('piggyvest db forwarder handshake and lifecycle', () => {
  it('destroys both sides when upstream never replies within the handshake deadline', async () => {
    const upstream = await startScripted((s) => s.resume());
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { handshakeTimeoutMs: 100 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await c.closed;
    await until(() => upstream.connections[0].destroyed);
    assert.equal(forwarder.stats().rejected.handshake_timeout, 1);
  });

  it('times out when upstream sends only the S byte and no TLS bytes', async () => {
    const upstream = await startScripted((s) => {
      s.once('data', () => s.write('S'));
    });
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { handshakeTimeoutMs: 100 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await c.closed;
    await until(() => upstream.connections[0].destroyed);
    assert.equal(forwarder.stats().rejected.handshake_timeout, 1);
  });

  it('clears the deadline once S plus TLS bytes have arrived', async () => {
    const upstream = await startScripted((s) => {
      s.once('data', () => s.write(Buffer.from([0x53, 0x16, 0x03])));
    });
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { handshakeTimeoutMs: 100 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => Buffer.concat(c.chunks).length === 3);
    await pause(250);
    assert.equal(c.socket.destroyed, false);
    assert.equal(forwarder.stats().rejected.handshake_timeout, undefined);
  });

  it('clears the deadline when S and TLS bytes arrive in separate segments', async () => {
    const upstream = await startScripted((s) => {
      s.once('data', async () => {
        s.write('S');
        await pause(30);
        s.write(Buffer.from([0x16]));
      });
    });
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { handshakeTimeoutMs: 200 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => Buffer.concat(c.chunks).length === 2);
    await pause(350);
    assert.equal(c.socket.destroyed, false);
    assert.equal(forwarder.stats().rejected.handshake_timeout, undefined);
  });

  it('destroys both sides immediately when upstream refuses SSL with N', async () => {
    const upstream = await startScripted((s) => {
      s.once('data', () => s.write('N'));
    });
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await c.closed;
    await until(() => upstream.connections[0].destroyed);
    assert.equal(forwarder.stats().rejected.upstream_refused_ssl, 1);
    assert.equal(c.text().includes('N'), false);
  });

  it('destroys the connection when client data arrives in a later segment before the upstream reply', async () => {
    const upstream = await startScripted((s) => s.resume());
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 1);
    await pause(30);
    c.socket.write(Buffer.from('plaintext-startup'));
    await c.closed;
    await until(() => upstream.connections[0].destroyed);
    assert.equal(forwarder.stats().rejected.data_before_ssl_reply, 1);
  });

  it('survives server-level errors such as EMFILE and logs only the code', async () => {
    const upstream = await startFakeUpstream();
    const logs = [];
    const { forwarder, port } = await startForwarder({
      upstreamPort: upstream.port,
      logs,
    });
    assert.doesNotThrow(() =>
      forwarder.server.emit(
        'error',
        Object.assign(new Error('accept failed for 203.0.113.9'), {
          code: 'EMFILE',
        })
      )
    );
    const joined = logs.join('\n');
    assert.match(joined, /EMFILE/);
    assert.doesNotMatch(joined, /203\.0\.113\.9|accept failed/);
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 1);
  });

  it('close() does not wait for active clients and destroys both sockets', async () => {
    const upstream = await startFakeUpstream();
    const forwarder = createDbForwarder({
      listenPort: 0,
      listenHost: '127.0.0.1',
      upstream: { host: '127.0.0.1', port: upstream.port, family: 4 },
    });
    const port = await forwarder.listen();
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => c.chunks.length > 0);
    const started = Date.now();
    await forwarder.close();
    assert.equal(Date.now() - started < 1000, true);
    await c.closed;
    assert.equal(c.socket.destroyed, true);
    await until(() => upstream.connections[0].destroyed);
  });
});
