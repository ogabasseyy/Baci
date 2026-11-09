/**
 * PiggyVest DB forwarder: a TCP PASSTHROUGH to the Supabase direct Postgres
 * host. Vercel functions are IPv4-only and the direct host is IPv6-only, so
 * this VPS (which has IPv6) relays the bytes.
 *
 * It never terminates, inspects or modifies TLS. The only thing it reads is
 * the first 8 bytes, which must be exactly a Postgres SSLRequest; anything else
 * is closed without contacting upstream. After that both directions are piped
 * untouched, so the client's TLS session is end to end with Postgres and the
 * forwarder only ever sees ciphertext. Upstream must answer 'S' (never 'N', so
 * no plaintext session) and start TLS within a deadline; the client may not
 * send anything until that reply. See docs/runbooks/piggyvest-db-forwarder.md.
 *
 * Logs carry only aggregate counts and reasons, plus a salted, truncated hash
 * of the source address (never the address, never any payload).
 */

import { createHash, randomBytes } from 'node:crypto';
import { connect, createServer } from 'node:net';

// Postgres SSLRequest: Int32(8) length, Int32(80877103) request code.
export const SSL_REQUEST = Buffer.from([
  0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f,
]);

export const PRODUCTION_UPSTREAM = Object.freeze({
  host: 'db.aivqthbxdshhltbwipbr.supabase.co',
  port: 5432,
  family: 6,
});

export const DEFAULT_LIMITS = Object.freeze({
  maxConnections: 60,
  maxPerSource: 20,
  connectTimeoutMs: 5_000,
  firstBytesTimeoutMs: 5_000,
  handshakeTimeoutMs: 15_000,
  idleTimeoutMs: 10 * 60_000,
});

function noop() {
  // logging is off unless a logger is injected
}

function normalizeAddress(address) {
  if (!address) return 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

// Cap key: IPv4 stays as is; IPv6 collapses to its /64 prefix so one client
// holding a whole /64 cannot multiply its per-source budget.
export function sourceKey(address) {
  if (!address.includes(':')) return address;
  const [head, tail = ''] = address.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [
        ...first,
        ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'),
        ...last,
      ]
    : first;
  return groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().padStart(4, '0'))
    .join(':');
}

export function createDbForwarder({
  listenPort,
  listenHost = '::',
  upstream = PRODUCTION_UPSTREAM,
  limits = {},
  log = noop,
} = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const salt = randomBytes(16);
  const perSource = new Map();
  const counters = { accepted: 0, forwarded: 0, active: 0 };
  const rejected = {};
  let active = 0;
  const sockets = new Set();

  const hashSource = (address) =>
    createHash('sha256').update(salt).update(address).digest('hex').slice(0, 8);
  const reject = (reason, source) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
    log(`reject reason=${reason} src=${source}`);
  };

  const server = createServer({ pauseOnConnect: true }, (client) => {
    const address = sourceKey(normalizeAddress(client.remoteAddress));
    const source = hashSource(address);
    client.on('error', noop);
    sockets.add(client);
    client.once('close', () => sockets.delete(client));

    if (active >= config.maxConnections) {
      reject('global_cap', source);
      client.destroy();
      return;
    }
    const sourceCount = perSource.get(address) ?? 0;
    if (sourceCount >= config.maxPerSource) {
      reject('source_cap', source);
      client.destroy();
      return;
    }
    active += 1;
    perSource.set(address, sourceCount + 1);
    counters.accepted += 1;

    let upstreamSocket = null;
    let timer = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    client.once('close', () => {
      clear();
      upstreamSocket?.destroy();
      active -= 1;
      const remaining = (perSource.get(address) ?? 1) - 1;
      if (remaining <= 0) perSource.delete(address);
      else perSource.set(address, remaining);
    });
    const fail = (reason) => {
      reject(reason, source);
      client.destroy();
    };

    let received = Buffer.alloc(0);
    const onData = (chunk) => {
      received = Buffer.concat([received, chunk]);
      const compared = Math.min(received.length, SSL_REQUEST.length);
      if (
        !received
          .subarray(0, compared)
          .equals(SSL_REQUEST.subarray(0, compared))
      ) {
        client.off('data', onData);
        fail('not_ssl_request');
        return;
      }
      if (received.length < SSL_REQUEST.length) return;
      client.off('data', onData);
      client.pause();
      clear();
      if (received.length > SSL_REQUEST.length) {
        // A real client waits for the server's 'S' before sending anything.
        fail('data_before_ssl_reply');
        return;
      }
      openUpstream();
    };

    const openUpstream = () => {
      upstreamSocket = connect({
        host: upstream.host,
        port: upstream.port,
        family: upstream.family ?? 6,
        // Tests only: injected through the factory, never from env.
        ...(upstream.lookup ? { lookup: upstream.lookup } : {}),
      });
      sockets.add(upstreamSocket);
      upstreamSocket.once('close', () => sockets.delete(upstreamSocket));
      let connected = false;
      upstreamSocket.on('error', () => {
        if (connected) {
          client.destroy();
          return;
        }
        fail('upstream_error');
      });
      upstreamSocket.once('close', () => client.destroy());
      timer = setTimeout(
        () => fail('connect_timeout'),
        config.connectTimeoutMs
      );
      upstreamSocket.once('connect', () => {
        connected = true;
        clear();
        if (client.destroyed) {
          upstreamSocket.destroy();
          return;
        }
        counters.forwarded += 1;
        client.setTimeout(config.idleTimeoutMs, () => {
          reject('idle_timeout', source);
          client.destroy();
        });
        upstreamSocket.setTimeout(config.idleTimeoutMs, () => {
          reject('idle_timeout', source);
          client.destroy();
        });
        awaitUpstreamReply();
        upstreamSocket.write(received);
        client.resume();
      });
    };

    // After the SSLRequest is forwarded: the client must stay silent, and
    // upstream must reply 'S' and then start TLS (>= 2 bytes) in time.
    const awaitUpstreamReply = () => {
      const onClientData = () => fail('data_before_ssl_reply');
      client.on('data', onClientData);
      timer = setTimeout(
        () => fail('handshake_timeout'),
        config.handshakeTimeoutMs
      );
      let total = 0;
      let piped = false;
      upstreamSocket.on('data', (chunk) => {
        if (!piped) {
          if (chunk[0] !== 0x53) {
            fail('upstream_refused_ssl');
            return;
          }
          piped = true;
          client.off('data', onClientData);
          client.write(chunk);
          client.pipe(upstreamSocket);
          upstreamSocket.pipe(client);
        }
        total += chunk.length;
        if (total >= 2) clear();
      });
    };

    timer = setTimeout(
      () => fail('first_bytes_timeout'),
      config.firstBytesTimeoutMs
    );
    client.on('data', onData);
    client.resume();
  });

  // Accept-time failures (EMFILE/ENFILE) must not crash the process.
  server.on('error', (error) => {
    log(`server_error code=${error?.code ?? 'unknown'}`);
  });

  return {
    server,
    stats: () => ({ ...counters, active, rejected: { ...rejected } }),
    listen: () =>
      new Promise((resolve, reject_) => {
        server.once('error', reject_);
        server.listen(
          { port: listenPort, host: listenHost, ipv6Only: false },
          () => {
            server.off('error', reject_);
            resolve(server.address().port);
          }
        );
      }),
    close: () =>
      new Promise((resolve) => {
        // Do not wait for active clients: destroy every tracked socket.
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}
