/**
 * PiggyVest egress relay HTTP server (plain node:http, no dependencies).
 *
 * Forwards allowlisted, HMAC-authenticated requests to the fixed PiggyVest
 * production origin from the VPS, whose IP is whitelisted by PiggyVest.
 * Relay-originated failures always carry `x-baci-relay-error`; whether the
 * upstream may have received the request is `x-baci-relay-upstream`
 * (`not-sent` | `maybe-sent`). Callers must treat anything but an explicit
 * `not-sent` as indeterminate: money may have moved.
 */

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { matchAllowlistedTarget } from './piggyvest-egress-relay-allowlist.mjs';
import {
  createReplayCache,
  RELAY_AUTH_HEADER,
  verifyRelayRequest,
} from './piggyvest-egress-relay-auth.mjs';

export const PRODUCTION_UPSTREAM = Object.freeze({
  request: httpsRequest,
  hostname: 'api.piggyvest.business',
  port: 443,
  readyEvent: 'secureConnect',
});

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'idempotency-key',
];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'retry-after'];
const DEFAULT_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 1024 * 1024,
  // Above the web client's own 30s request timeout.
  upstreamTimeoutMs: 35_000,
  maxInFlight: 64,
});

function noop() {
  // logging is off unless a logger is injected
}

export function createRelayServer({
  secret,
  upstream = PRODUCTION_UPSTREAM,
  now = Date.now,
  monotonicNow = () => performance.now(),
  log = noop,
  limits = {},
} = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const replays = createReplayCache({ now: monotonicNow });
  // Replay cache is memory-only: refuse anything signed before this start.
  const startedAtSeconds = Math.floor(now() / 1000);
  let inFlight = 0;

  const handler = async (request, response) => {
    const startedAt = now();
    const outcome = { route: '-', status: 0, relayError: '' };
    const finish = (status, body, headers = {}) => {
      outcome.status = status;
      response.writeHead(status, headers);
      response.end(body);
    };
    const relayError = (status, code, upstreamState) => {
      outcome.relayError = code;
      finish(status, JSON.stringify({ error: 'relay_error', code }), {
        'content-type': 'application/json',
        'x-baci-relay-error': code,
        'x-baci-relay-upstream': upstreamState,
      });
    };

    inFlight += 1;
    try {
      await route(request, relayError, finish, outcome);
    } catch {
      if (!response.headersSent) relayError(502, 'internal_error', 'not-sent');
    } finally {
      inFlight -= 1;
      // Method, allowlisted template, status, latency: nothing else.
      log(
        `${request.method} ${outcome.route} ${outcome.status} ${now() - startedAt}ms` +
          (outcome.relayError ? ` relay_error=${outcome.relayError}` : '')
      );
    }
  };

  async function route(request, relayError, finish, outcome) {
    if (request.method === 'GET' && request.url === '/healthz') {
      finish(200, 'ok', { 'content-type': 'text/plain' });
      return;
    }
    if (typeof secret !== 'string' || secret.length < 32) {
      relayError(503, 'not_configured', 'not-sent');
      return;
    }
    if (inFlight > config.maxInFlight) {
      relayError(503, 'overloaded', 'not-sent');
      return;
    }
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > config.maxRequestBytes) {
      relayError(413, 'request_too_large', 'not-sent');
      return;
    }
    const body = await readBody(request, config.maxRequestBytes);
    if (body === null) {
      relayError(413, 'request_too_large', 'not-sent');
      return;
    }

    const target = request.url ?? '';
    const verdict = verifyRelayRequest({
      secret,
      header: request.headers[RELAY_AUTH_HEADER],
      method: request.method ?? '',
      target,
      body,
      nowSeconds: Math.floor(now() / 1000),
      notBeforeSeconds: startedAtSeconds,
    });
    if (!verdict.ok) {
      relayError(401, `auth_${verdict.reason}`, 'not-sent');
      return;
    }
    if (replays.has(verdict.signature)) {
      relayError(401, 'auth_replay', 'not-sent');
      return;
    }
    if (!replays.add(verdict.signature)) {
      relayError(503, 'replay_cache_full', 'not-sent');
      return;
    }

    const match = matchAllowlistedTarget(request.method, target);
    if (!match) {
      relayError(404, 'not_allowlisted', 'not-sent');
      return;
    }
    outcome.route = match.template;
    await forward({ request, target, body, relayError, finish });
  }

  function forward({ request, target, body, relayError, finish }) {
    return new Promise((resolve) => {
      const headers = { 'content-length': String(body.length) };
      for (const name of FORWARD_REQUEST_HEADERS) {
        if (typeof request.headers[name] === 'string') {
          headers[name] = request.headers[name];
        }
      }
      headers['user-agent'] = 'baci-egress-relay/1';
      let connected = false;
      let settled = false;
      const settle = (action) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
        resolve();
      };
      const outgoing = upstream.request({
        hostname: upstream.hostname,
        port: upstream.port,
        path: target,
        method: request.method,
        headers,
        // No keep-alive reuse and no redirect handling: node never follows.
        agent: false,
      });
      const timer = setTimeout(() => {
        settle(() => relayError(504, 'upstream_timeout', 'maybe-sent'));
        outgoing.destroy();
      }, config.upstreamTimeoutMs);

      outgoing.on('socket', (socket) => {
        if (!socket.connecting && !socket.encrypted) connected = true;
        socket.once(upstream.readyEvent, () => {
          connected = true;
        });
      });
      outgoing.on('error', () => {
        settle(() =>
          relayError(
            502,
            connected ? 'upstream_connection_lost' : 'upstream_unreachable',
            connected ? 'maybe-sent' : 'not-sent'
          )
        );
      });
      outgoing.on('response', (upstreamResponse) => {
        const status = upstreamResponse.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          upstreamResponse.resume();
          settle(() => relayError(502, 'upstream_redirect', 'maybe-sent'));
          outgoing.destroy();
          return;
        }
        const chunks = [];
        let total = 0;
        upstreamResponse.on('data', (chunk) => {
          total += chunk.length;
          if (total > config.maxResponseBytes) {
            settle(() => relayError(502, 'response_too_large', 'maybe-sent'));
            outgoing.destroy();
            return;
          }
          chunks.push(chunk);
        });
        upstreamResponse.on('error', () => {
          settle(() =>
            relayError(502, 'upstream_connection_lost', 'maybe-sent')
          );
        });
        upstreamResponse.on('aborted', () => {
          settle(() =>
            relayError(502, 'upstream_connection_lost', 'maybe-sent')
          );
        });
        upstreamResponse.on('end', () => {
          const payload = Buffer.concat(chunks);
          const out = { 'x-baci-relay-upstream': 'sent' };
          for (const name of FORWARD_RESPONSE_HEADERS) {
            if (typeof upstreamResponse.headers[name] === 'string') {
              out[name] = upstreamResponse.headers[name];
            }
          }
          out['content-length'] = String(payload.length);
          settle(() => finish(status, payload, out));
        });
      });
      outgoing.end(body);
    });
  }

  return createServer(handler);
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
