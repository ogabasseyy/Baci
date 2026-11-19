import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { runPiggyvestDbForwarder } from '../jobs/piggyvest-db-forwarder.mjs';
import {
  PRODUCTION_UPSTREAM,
  SSL_REQUEST,
  sourceKey,
} from './piggyvest-db-forwarder.mjs';
import {
  cleanups,
  client,
  noop,
  pause,
  runCleanups,
  startFakeUpstream,
  startForwarder,
  until,
} from './piggyvest-db-forwarder-test-support.mjs';

afterEach(runCleanups);

describe('piggyvest db forwarder', () => {
  for (const [name, bytes] of [
    [
      'plaintext StartupMessage',
      Buffer.from([
        0, 0, 0, 16, 0, 3, 0, 0, 0x75, 0x73, 0x65, 0x72, 0, 0, 0, 0,
      ]),
    ],
    ['GSSENCRequest', Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x30])],
    [
      'CancelRequest',
      Buffer.from([
        0, 0, 0, 16, 0x04, 0xd2, 0x16, 0x2e, 0, 0, 0, 1, 0, 0, 0, 2,
      ]),
    ],
    ['garbage', Buffer.from('GET / HTTP/1.1\r\n\r\n')],
    ['garbage that diverges on the first byte', Buffer.from([0xff])],
  ]) {
    it(`closes ${name} without contacting upstream`, async () => {
      const upstream = await startFakeUpstream();
      const { forwarder, port } = await startForwarder({
        upstreamPort: upstream.port,
      });
      const c = client(port);
      c.socket.write(bytes);
      await c.closed;
      await pause(50);
      assert.equal(upstream.connections.length, 0);
      assert.equal(c.chunks.length, 0);
      assert.equal(forwarder.stats().rejected.not_ssl_request, 1);
    });
  }

  it('closes an SSLRequest followed by extra bytes without contacting upstream', async () => {
    const upstream = await startFakeUpstream();
    const { port } = await startForwarder({ upstreamPort: upstream.port });
    const c = client(port);
    c.socket.write(Buffer.concat([SSL_REQUEST, Buffer.from('x')]));
    await c.closed;
    assert.equal(upstream.connections.length, 0);
  });

  it('forwards the SSLRequest and then pipes bytes both ways untouched', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
    });
    const c = client(port);
    // Split across writes: the forwarder must buffer until 8 bytes.
    c.socket.write(SSL_REQUEST.subarray(0, 3));
    await pause(20);
    c.socket.write(SSL_REQUEST.subarray(3));
    await until(() =>
      Buffer.concat(c.chunks).equals(
        Buffer.concat([Buffer.from('Secho:'), SSL_REQUEST])
      )
    );
    assert.deepEqual(Buffer.concat(upstream.received), SSL_REQUEST);
    const hello = Buffer.from([0x16, 0x03, 0x01, 0xde, 0xad, 0xbe, 0xef]);
    c.socket.write(hello);
    await until(
      () => Buffer.concat(c.chunks).length === 6 + 8 + 6 + hello.length
    );
    assert.deepEqual(
      Buffer.concat(upstream.received),
      Buffer.concat([SSL_REQUEST, hello])
    );
    assert.equal(forwarder.stats().forwarded, 1);
  });

  it('tears down the client when upstream closes, and upstream when the client closes', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
    });
    const a = client(port);
    a.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 1);
    upstream.connections[0].destroy();
    await a.closed;
    const b = client(port);
    b.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 2);
    b.socket.destroy();
    await until(() => upstream.connections[1].destroyed);
    await until(() => forwarder.stats().active === 0);
  });

  it('closes the client when the upstream is unreachable', async () => {
    const dead = createServer();
    await new Promise((r) => dead.listen(0, '127.0.0.1', r));
    const deadPort = dead.address().port;
    await new Promise((r) => dead.close(r));
    const { port, forwarder } = await startForwarder({
      upstreamPort: deadPort,
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await c.closed;
    assert.equal(forwarder.stats().rejected.upstream_error, 1);
  });

  it('closes idle forwarded connections', async () => {
    const upstream = await startFakeUpstream();
    const { port, forwarder } = await startForwarder({
      upstreamPort: upstream.port,
      limits: { idleTimeoutMs: 100 },
    });
    const c = client(port);
    c.socket.write(SSL_REQUEST);
    await until(() => upstream.connections.length === 1);
    await c.closed;
    assert.equal(forwarder.stats().rejected.idle_timeout >= 1, true);
  });

  it('logs only aggregate reasons and a hashed source, never addresses or payload', async () => {
    const upstream = await startFakeUpstream();
    const logs = [];
    const { port } = await startForwarder({
      upstreamPort: upstream.port,
      logs,
    });
    const c = client(port);
    c.socket.write(Buffer.from('SECRET-PAYLOAD-123'));
    await c.closed;
    const joined = logs.join('\n');
    assert.match(joined, /reject reason=not_ssl_request src=[0-9a-f]{8}$/);
    assert.doesNotMatch(joined, /127\.0\.0\.1|SECRET-PAYLOAD/);
  });

  it('fixes the production upstream and does not read it from env', async () => {
    assert.deepEqual(PRODUCTION_UPSTREAM, {
      host: 'db.aivqthbxdshhltbwipbr.supabase.co',
      port: 5432,
      family: 6,
    });
    assert.equal(Object.isFrozen(PRODUCTION_UPSTREAM), true);
    for (const file of [
      '../jobs/piggyvest-db-forwarder.mjs',
      './piggyvest-db-forwarder.mjs',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /process\.env/);
    }
    const sentinel = {
      PIGGYVEST_DB_UPSTREAM_HOST: 'evil.example',
      UPSTREAM_HOST: 'evil.example',
    };
    const saved = { ...process.env };
    Object.assign(process.env, sentinel);
    try {
      const running = await runPiggyvestDbForwarder({ port: 0, log: noop });
      cleanups.push(() => running.stop());
      assert.equal(typeof running.stats, 'function');
    } finally {
      for (const key of Object.keys(sentinel)) {
        if (key in saved) process.env[key] = saved[key];
        else delete process.env[key];
      }
    }
  });

  it('keys the per-source cap by /64 for IPv6 and by address for IPv4', () => {
    assert.equal(sourceKey('203.0.113.7'), '203.0.113.7');
    assert.equal(
      sourceKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'),
      '2001:0db8:0001:0002'
    );
    assert.equal(sourceKey('2001:DB8:1:2::9'), '2001:0db8:0001:0002');
    assert.equal(
      sourceKey('2001:db8:1:2:ffff::1'),
      sourceKey('2001:db8:1:2::2')
    );
    assert.notEqual(sourceKey('2001:db8:1:3::1'), sourceKey('2001:db8:1:2::1'));
    assert.equal(sourceKey('::1'), '0000:0000:0000:0000');
  });
});
