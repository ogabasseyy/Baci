import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { matchAllowlistedTarget } from './piggyvest-egress-relay-allowlist.mjs';
import {
  createReplayCache,
  signRelayRequest,
  verifyRelayRequest,
} from './piggyvest-egress-relay-auth.mjs';

const SECRET = 'test-relay-secret-0123456789abcdef0123';
const NONCE = '00112233445566778899aabbccddeeff';
const NOW = 1_700_000_000;
// Pinned cross-test vector: apps/web/src/lib/piggyvest/egress-relay.test.ts
// asserts the identical value so the two signers cannot drift apart.
const VECTOR =
  'v1.1700000000.00112233445566778899aabbccddeeff.867fba031efde17ec6a39061dfc0e06003b2d01e43195a167b858bca20421b16';

const base = {
  secret: SECRET,
  method: 'POST',
  target: '/api/v1/transfer/wallet',
  body: Buffer.from('{"amount":100}'),
  nowSeconds: NOW,
};

describe('relay signature', () => {
  it('matches the pinned cross-test vector', () => {
    assert.equal(
      signRelayRequest({ ...base, timestamp: NOW, nonce: NONCE }),
      VECTOR
    );
  });

  it('accepts a valid header', () => {
    const result = verifyRelayRequest({ ...base, header: VECTOR });
    assert.equal(result.ok, true);
  });

  it('rejects missing, malformed, and bad signatures', () => {
    assert.equal(
      verifyRelayRequest({ ...base, header: undefined }).reason,
      'missing'
    );
    assert.equal(
      verifyRelayRequest({ ...base, header: 'v1.x' }).reason,
      'malformed'
    );
    const tampered = VECTOR.slice(0, -1) + (VECTOR.endsWith('0') ? '1' : '0');
    assert.equal(
      verifyRelayRequest({ ...base, header: tampered }).reason,
      'bad_signature'
    );
  });

  it('binds method, target and body', () => {
    for (const change of [
      { method: 'PATCH' },
      { target: '/api/v1/transfer/bank' },
      { target: '/api/v1/transfer/wallet?a=1' },
      { body: Buffer.from('{"amount":101}') },
    ]) {
      assert.equal(
        verifyRelayRequest({ ...base, ...change, header: VECTOR }).reason,
        'bad_signature'
      );
    }
  });

  it('rejects stale and future timestamps beyond 60 seconds', () => {
    assert.equal(
      verifyRelayRequest({ ...base, nowSeconds: NOW + 61, header: VECTOR })
        .reason,
      'stale'
    );
    assert.equal(
      verifyRelayRequest({ ...base, nowSeconds: NOW - 61, header: VECTOR })
        .reason,
      'stale'
    );
    assert.equal(
      verifyRelayRequest({ ...base, nowSeconds: NOW + 60, header: VECTOR }).ok,
      true
    );
  });

  it('fails closed without a usable secret', () => {
    for (const secret of [undefined, '', 'short']) {
      assert.equal(
        verifyRelayRequest({ ...base, secret, header: VECTOR }).reason,
        'no_secret'
      );
    }
  });
});

describe('replay cache', () => {
  it('remembers within the ttl, forgets after, and fails closed when full', () => {
    let clock = 0;
    const cache = createReplayCache({
      ttlMs: 100,
      maxEntries: 2,
      now: () => clock,
    });
    assert.equal(cache.add('a'), true);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.add('b'), true);
    assert.equal(cache.add('c'), false);
    clock = 101;
    assert.equal(cache.has('a'), false);
    assert.equal(cache.add('c'), true);
  });
});

describe('replay cache clock', () => {
  it('keeps an entry through wall-clock jumps (expiry is monotonic)', () => {
    let wall = 1_700_000_000_000;
    const dateNow = mock.method(Date, 'now', () => wall);
    try {
      const cache = createReplayCache();
      assert.equal(cache.add('sig'), true);
      wall += 3_600_000; // wall clock stepped an hour forward
      assert.equal(cache.has('sig'), true);
      assert.equal(cache.add('other'), true); // a sweep must not drop it
      wall -= 3_600_000; // and corrected back into the signature's window
      assert.equal(cache.has('sig'), true);
    } finally {
      dateNow.mock.restore();
    }
  });
});

describe('allowlist', () => {
  const ok = (method, target) =>
    matchAllowlistedTarget(method, target)?.template;

  it('matches the PiggyVest paths the web app calls', () => {
    assert.equal(
      ok('POST', '/api/v1/transfer/wallet'),
      '/api/v1/transfer/wallet'
    );
    assert.equal(ok('POST', '/api/v1/transfer/bank'), '/api/v1/transfer/bank');
    assert.equal(ok('GET', '/api/v1/wallet/abc-123'), '/api/v1/wallet/:id');
    assert.equal(
      ok('GET', '/api/v1/wallet/abc/accounts'),
      '/api/v1/wallet/:id/accounts'
    );
    assert.equal(
      ok(
        'GET',
        '/api/v1/wallet/interests/accrued/w1?limit=10&interest_type=original'
      ),
      '/api/v1/wallet/interests/accrued/:id'
    );
    assert.equal(
      ok('GET', '/api/v1/transaction/verify?reference=r1&wallet_id=w1'),
      '/api/v1/transaction/verify'
    );
    assert.equal(
      ok('GET', '/api/v1/transaction/t1?wallet_id=w1'),
      '/api/v1/transaction/:id'
    );
    assert.equal(
      ok('GET', '/api/v1/transaction?wallet_id=w&limit=5&collapse_batch=0'),
      '/api/v1/transaction'
    );
    assert.equal(
      ok('PATCH', '/api/v1/transfer/schedule-payment/s1'),
      '/api/v1/transfer/schedule-payment/:id'
    );
    assert.equal(
      ok('POST', '/api/v1/customers?returnIfExist=true'),
      '/api/v1/customers'
    );
  });

  it('rejects wrong methods, unknown paths and unknown query keys', () => {
    assert.equal(ok('GET', '/api/v1/transfer/wallet'), undefined);
    assert.equal(ok('DELETE', '/api/v1/wallet/abc'), undefined);
    assert.equal(ok('POST', '/api/v1/transfer/test/funding'), undefined);
    assert.equal(ok('GET', '/api/v1/other'), undefined);
    assert.equal(
      ok('GET', '/api/v1/transaction/verify?reference=r&evil=1'),
      undefined
    );
    assert.equal(ok('POST', '/api/v1/transfer/wallet?x=1'), undefined);
    assert.equal(
      ok('GET', '/api/v1/transaction/verify?reference=a&reference=b'),
      undefined
    );
  });

  it('rejects absolute URLs, traversal, encoded separators and CRLF', () => {
    const bad = [
      'https://evil.example/api/v1/wallet/a',
      '//evil.example/api/v1/wallet/a',
      '/api/v1/wallet/../customers',
      '/api/v1/wallet/%2e%2e/customers',
      '/api/v1/wallet/a%2Fb',
      '/api/v1/wallet/a%5Cb',
      '/api/v1/wallet/a%00',
      '/api/v1/wallet/a%25252e',
      '/api/v1/wallet/a\r\nX-Evil: 1',
      '/api/v1/wallet/a b',
      '/api/v1/wallet/a#frag',
      '/api/v1/wallet/a\\b',
      '/api/v1/wallet/./a',
      '/api/v1/wallet/%zz',
      `/api/v1/wallet/${'a'.repeat(129)}`,
      'api/v1/wallet/a',
      '',
    ];
    for (const target of bad) {
      assert.equal(matchAllowlistedTarget('GET', target), null, target);
    }
  });
});
