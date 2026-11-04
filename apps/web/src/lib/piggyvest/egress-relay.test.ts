import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyRelayResponse,
  getPiggyvestEgressRelayConfig,
  PIGGYVEST_PRODUCTION_ORIGIN,
  routeThroughRelay,
  signPiggyvestRelayRequest,
} from './egress-relay';

const SECRET = 'test-relay-secret-0123456789abcdef0123';
const ENV = {
  PIGGYVEST_EGRESS_RELAY_URL: 'https://pv-egress.example.com',
  PIGGYVEST_EGRESS_RELAY_SECRET: SECRET,
};

describe('signPiggyvestRelayRequest', () => {
  // Pinned in vps-workers/lib/piggyvest-egress-relay-auth.test.mjs too: the
  // relay verifier and this signer must produce the identical value.
  it('matches the relay verifier cross-test vector', () => {
    expect(
      signPiggyvestRelayRequest({
        secret: SECRET,
        method: 'POST',
        target: '/api/v1/transfer/wallet',
        body: '{"amount":100}',
        timestamp: 1_700_000_000,
        nonce: '00112233445566778899aabbccddeeff',
      })
    ).toBe(
      'v1.1700000000.00112233445566778899aabbccddeeff.867fba031efde17ec6a39061dfc0e06003b2d01e43195a167b858bca20421b16'
    );
  });
});

describe('getPiggyvestEgressRelayConfig', () => {
  it('is null unless both values are present and valid', () => {
    expect(getPiggyvestEgressRelayConfig({})).toBeNull();
    expect(
      getPiggyvestEgressRelayConfig({
        PIGGYVEST_EGRESS_RELAY_URL: ENV.PIGGYVEST_EGRESS_RELAY_URL,
      })
    ).toBeNull();
    expect(
      getPiggyvestEgressRelayConfig({
        PIGGYVEST_EGRESS_RELAY_SECRET: SECRET,
      })
    ).toBeNull();
    expect(
      getPiggyvestEgressRelayConfig({
        ...ENV,
        PIGGYVEST_EGRESS_RELAY_SECRET: 'short',
      })
    ).toBeNull();
  });

  it('accepts an https origin and rejects unsafe or non-origin URLs', () => {
    expect(getPiggyvestEgressRelayConfig(ENV)).toEqual({
      origin: 'https://pv-egress.example.com',
      secret: SECRET,
    });
    for (const url of [
      'http://pv-egress.example.com',
      'https://user:pw@pv-egress.example.com',
      'https://pv-egress.example.com/prefix',
      'https://pv-egress.example.com/?a=1',
      'not a url',
    ]) {
      expect(
        getPiggyvestEgressRelayConfig({
          ...ENV,
          PIGGYVEST_EGRESS_RELAY_URL: url,
        })
      ).toBeNull();
    }
    expect(
      getPiggyvestEgressRelayConfig({
        ...ENV,
        PIGGYVEST_EGRESS_RELAY_URL: 'http://127.0.0.1:18910',
      })
    ).toEqual({ origin: 'http://127.0.0.1:18910', secret: SECRET });
  });
});

describe('routeThroughRelay', () => {
  const request = {
    url: `${PIGGYVEST_PRODUCTION_ORIGIN}/api/v1/transaction/verify?reference=r%201&wallet_id=w1`,
    method: 'GET',
    headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
  };
  const options = {
    env: ENV,
    now: () => 1_700_000_000_500,
    nonce: () => 'a'.repeat(32),
  };

  it('returns null when the relay is not configured', () => {
    expect(routeThroughRelay(request, { env: {} })).toBeNull();
  });

  it('never reroutes other origins such as Paystack or the sandbox', () => {
    for (const url of [
      'https://api.paystack.co/transaction/verify/x',
      'https://staging.piggyvest.business/api/v1/wallet/w1',
      'https://api.piggyvest.business.evil.example/api/v1/wallet/w1',
    ]) {
      expect(routeThroughRelay({ ...request, url }, options)).toBeNull();
    }
  });

  it('cannot be redirected to another host by a path that normalizes to //host', () => {
    const routed = routeThroughRelay(
      {
        ...request,
        url: 'https://api.piggyvest.business/.//attacker.example/path?x=1',
      },
      options
    );
    expect(routed).not.toBeNull();
    expect(new URL(routed?.url ?? '').origin).toBe(
      'https://pv-egress.example.com'
    );
    expect(new URL(routed?.url ?? '').hostname).not.toBe('attacker.example');
  });

  it('keeps the exact path and query, keeps credentials, and signs the target', () => {
    const routed = routeThroughRelay(request, options);
    expect(routed?.url).toBe(
      'https://pv-egress.example.com/api/v1/transaction/verify?reference=r%201&wallet_id=w1'
    );
    expect(routed?.headers.Authorization).toBe('Bearer k');
    expect(routed?.headers['x-baci-relay-auth']).toBe(
      signPiggyvestRelayRequest({
        secret: SECRET,
        method: 'GET',
        target: '/api/v1/transaction/verify?reference=r%201&wallet_id=w1',
        timestamp: 1_700_000_000,
        nonce: 'a'.repeat(32),
      })
    );
  });

  it('signs the body and uses a fresh nonce per call', () => {
    const post = { ...request, method: 'POST', body: '{"amount":1}' };
    const first = routeThroughRelay(post, { env: ENV });
    const second = routeThroughRelay(post, { env: ENV });
    expect(first?.headers['x-baci-relay-auth']).not.toBe(
      second?.headers['x-baci-relay-auth']
    );
    const unsigned = routeThroughRelay(
      { ...post, body: '{"amount":2}' },
      options
    );
    const signed = routeThroughRelay(post, options);
    expect(unsigned?.headers['x-baci-relay-auth']).not.toBe(
      signed?.headers['x-baci-relay-auth']
    );
  });
});

describe('classifyRelayResponse', () => {
  const make = (status: number, headers: Record<string, string>) =>
    new Response('{}', { status, headers });

  it('passes genuine PiggyVest answers through, including 401/404/5xx', () => {
    for (const status of [200, 400, 401, 404, 422, 500]) {
      expect(
        classifyRelayResponse(make(status, { 'x-baci-relay-upstream': 'sent' }))
      ).toBeNull();
    }
  });

  it('treats explicit not-sent relay errors as definite', () => {
    for (const [status, code] of [
      [401, 'auth_stale'],
      [404, 'not_allowlisted'],
      [503, 'not_configured'],
    ] as const) {
      expect(
        classifyRelayResponse(
          make(status, {
            'x-baci-relay-error': code,
            'x-baci-relay-upstream': 'not-sent',
          })
        )
      ).toEqual({ sendState: 'not-sent', code });
    }
  });

  it('treats maybe-sent, timeouts, unknown markers and non-relay answers as indeterminate', () => {
    expect(
      classifyRelayResponse(
        make(504, {
          'x-baci-relay-error': 'upstream_timeout',
          'x-baci-relay-upstream': 'maybe-sent',
        })
      )?.sendState
    ).toBe('maybe-sent');
    expect(
      classifyRelayResponse(
        make(504, {
          'x-baci-relay-error': 'x',
          'x-baci-relay-upstream': 'not-sent',
        })
      )?.sendState
    ).toBe('maybe-sent');
    expect(
      classifyRelayResponse(make(502, { 'x-baci-relay-error': 'x' }))?.sendState
    ).toBe('maybe-sent');
    expect(classifyRelayResponse(make(502, {}))).toEqual({
      sendState: 'maybe-sent',
      code: 'relay_unexpected_response',
    });
    expect(classifyRelayResponse(make(200, {}))?.sendState).toBe('maybe-sent');
  });
});

describe('turbo env passthrough', () => {
  it('declares the relay variables so Vercel builds do not hash them', () => {
    const turbo = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../../../turbo.json'), 'utf8')
    ) as { globalPassThroughEnv?: string[] };
    expect(turbo.globalPassThroughEnv).toEqual(
      expect.arrayContaining([
        'PIGGYVEST_EGRESS_RELAY_URL',
        'PIGGYVEST_EGRESS_RELAY_SECRET',
      ])
    );
  });
});
