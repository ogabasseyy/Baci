import { createServer, request as httpRequest } from 'node:http';
import { afterEach } from 'node:test';
import { signRelayRequest } from './piggyvest-egress-relay-auth.mjs';
import { createRelayServer } from './piggyvest-egress-relay-server.mjs';

export const SECRET = 'test-relay-secret-0123456789abcdef0123';
export const NOW_SECONDS = 1_700_000_000;
export const PV_KEY = 'pv-secret-key-do-not-log';
let counter = 0;
const open = [];

export function listen(server) {
  open.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
}

afterEach(async () => {
  await Promise.all(
    open.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        })
    )
  );
});

export async function startRelay({
  upstreamHandler,
  secret = SECRET,
  limits,
  upstreamPort,
  nowMs = NOW_SECONDS * 1000,
}) {
  const seen = [];
  let port = upstreamPort;
  if (upstreamHandler) {
    const upstream = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        upstreamHandler(req, res, seen.length);
      });
    });
    port = await listen(upstream);
  }
  const logs = [];
  const relay = createRelayServer({
    secret,
    now: () => nowMs,
    log: (line) => logs.push(line),
    limits,
    upstream: {
      request: httpRequest,
      hostname: '127.0.0.1',
      port,
      readyEvent: 'connect',
    },
  });
  const relayPort = await listen(relay);
  return { relayPort, seen, logs };
}

export function call(
  relayPort,
  {
    method = 'GET',
    target,
    body = '',
    headers = {},
    sign = true,
    timestamp = NOW_SECONDS,
    nonce,
  }
) {
  const auth = sign
    ? {
        'x-baci-relay-auth': signRelayRequest({
          secret: SECRET,
          method,
          target,
          body: Buffer.from(body),
          timestamp,
          nonce: nonce ?? (++counter).toString(16).padStart(32, '0'),
        }),
      }
    : {};
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: relayPort,
        method,
        path: target,
        headers: { authorization: `Bearer ${PV_KEY}`, ...auth, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

export const ok = (_req, res) => {
  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': 'a=b',
  });
  res.end('{"status":true,"message":"ok","data":{}}');
};
