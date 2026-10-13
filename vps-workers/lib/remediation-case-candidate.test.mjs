import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRemediationCaseCandidateNormalizer } from './remediation-case-candidate.mjs';

describe('remediation case candidate normalizer', () => {
  it('keeps only allowlisted Vercel evidence out of lifecycle state', () => {
    const normalize = createRemediationCaseCandidateNormalizer().normalize;
    const candidate = normalize({
      category: 'vercel_runtime_exception',
      fingerprint: 'vercel-pii',
      occurrences: 2,
      sample: {
        deploymentId: 'dpl_safe',
        errorClass: 'TypeError',
        message: 'Alice Okafor at 12 Example Road email alice@example.com',
        requestId: 'req_safe',
        route: '/orders?email=alice@example.com',
        source: 'vercel',
        stack: 'arbitrary JSON {"body":"customer value"}',
        statusCode: 500,
      },
      source: 'vercel',
    });

    assert.deepEqual(candidate.sample, {
      deploymentId: 'dpl_safe',
      errorClass: 'TypeError',
      requestId: 'req_safe',
      route: '/orders',
      source: 'vercel',
      statusCode: '500',
    });
  });

  it('accepts only finite nonnegative integer occurrences and approved fields', () => {
    const normalize = createRemediationCaseCandidateNormalizer().normalize;
    for (const occurrences of [-1, 1.5, Number.POSITIVE_INFINITY, '2']) {
      assert.equal(
        normalize({
          fingerprint: 'safe',
          occurrences,
          sample: { source: 'sentry' },
          source: 'sentry',
        }).occurrences,
        0
      );
    }

    const normalized = normalize({
      fingerprint: 'safe',
      occurrences: 2,
      sample: { source: 'sentry' },
      source: 'sentry',
      untrustedPayload: { credentials: 'do-not-carry' },
    });

    assert.equal(normalized.occurrences, 2);
    assert.equal(normalized.untrustedPayload, undefined);
  });

  it('canonicalizes provider observation timestamps before lifecycle persistence', () => {
    const normalized = createRemediationCaseCandidateNormalizer().normalize({
      fingerprint: 'safe',
      firstSeen: '2026-08-09T10:00:00Z',
      lastSeen: '2026-08-09T10:01:00Z',
      occurrences: 2,
      sample: { source: 'sentry' },
      source: 'sentry',
    });

    assert.equal(normalized.firstSeen, '2026-08-09T10:00:00.000Z');
    assert.equal(normalized.lastSeen, '2026-08-09T10:01:00.000Z');
  });

  it('uses a neutral category for candidates with an unknown source', () => {
    const normalized = createRemediationCaseCandidateNormalizer().normalize({
      fingerprint: 'unknown-source',
      sample: { source: 'unrecognized-provider' },
      source: 'unrecognized-provider',
    });

    assert.equal(normalized.category, 'unknown_error');
    assert.equal(normalized.caseKey, 'unknown:unknown_error:unknown-source');
  });

  it('keeps the same highest-occurrence representative for duplicate observations', () => {
    const normalizer = createRemediationCaseCandidateNormalizer();
    const lower = {
      fingerprint: 'duplicate',
      firstSeen: '2026-08-09T10:00:00.000Z',
      lastSeen: '2026-08-09T10:01:00.000Z',
      occurrences: 2,
      sample: { message: 'lower', source: 'sentry' },
      source: 'sentry',
    };
    const higher = {
      ...lower,
      firstSeen: '2026-08-09T09:59:00.000Z',
      occurrences: 5,
      sample: { message: 'higher', source: 'sentry' },
    };

    const first = normalizer.normalizeAll([lower, higher]);
    const second = normalizer.normalizeAll([higher, lower]);

    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0].occurrences, 5);
    assert.equal(first[0].sample.message, 'higher');
  });

  it('prefers the newest canonical observation over a stale paginated snapshot', () => {
    const normalizer = createRemediationCaseCandidateNormalizer();
    const stale = {
      fingerprint: 'paginated',
      lastSeen: '2026-08-09T10:01:00.000Z',
      occurrences: 8,
      sample: { message: 'stale', source: 'sentry' },
      source: 'sentry',
    };
    const newer = {
      ...stale,
      lastSeen: '2026-08-09T10:02:00.000Z',
      occurrences: 3,
      sample: { message: 'newer', source: 'sentry' },
    };

    const result = normalizer.normalizeAll([stale, newer]);

    assert.equal(result.length, 1);
    assert.equal(result[0].lastSeen, '2026-08-09T10:02:00.000Z');
    assert.equal(result[0].sample.message, 'newer');
  });

  it('redacts long compact digit runs and keeps redacted evidence bounded', () => {
    const normalized = createRemediationCaseCandidateNormalizer().normalize({
      fingerprint: 'long-digits',
      occurrences: 2,
      sample: {
        message: Array.from({ length: 300 }, () => '9'.repeat(16)).join(' '),
        source: 'sentry',
      },
      source: 'sentry',
    });

    assert.equal(normalized.sample.message.length <= 1_000, true);
    assert.equal(normalized.sample.message.includes('9'.repeat(16)), false);
    assert.match(normalized.sample.message, /\[REDACTED_PHONE\]/);
  });
});
