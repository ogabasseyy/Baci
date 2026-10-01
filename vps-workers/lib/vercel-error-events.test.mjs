import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fingerprintErrorEvent,
  groupErrorEvents,
  isErrorEvent,
  normalizeVercelLogEvent,
  selectRemediationCandidates,
} from './vercel-error-events.mjs';

describe('vercel error events', () => {
  it('normalizes common Vercel log drain shapes', () => {
    const event = normalizeVercelLogEvent({
      level: 'error',
      message: 'TypeError: Cannot read properties of undefined',
      requestId: 'req_123',
      source: 'lambda',
      projectName: 'baci-web',
      deploymentId: 'dpl_123',
      path: '/api/orders/123',
      timestamp: '2026-05-19T12:00:00.000Z',
    });

    assert.equal(event.level, 'error');
    assert.equal(
      event.message,
      'TypeError: Cannot read properties of undefined'
    );
    assert.equal(event.route, '/api/orders/123');
    assert.equal(event.requestId, 'req_123');
    assert.equal(event.deploymentId, 'dpl_123');
  });

  it('removes query and fragment values from Vercel route evidence', () => {
    const event = normalizeVercelLogEvent({
      level: 'error',
      message: 'Error: stable',
      path: '/orders?email=alice@example.com&token=secret#profile',
    });

    assert.equal(event.route, '/orders');
  });

  it('classifies runtime errors and 5xx responses but ignores expected noise', () => {
    assert.equal(
      isErrorEvent(
        normalizeVercelLogEvent({
          level: 'info',
          message: 'GET /api/products 200',
          statusCode: 200,
        })
      ),
      false
    );
    assert.equal(
      isErrorEvent(
        normalizeVercelLogEvent({
          level: 'warn',
          message: 'GET /missing 404',
          statusCode: 404,
        })
      ),
      false
    );
    assert.equal(
      isErrorEvent(
        normalizeVercelLogEvent({
          level: 'info',
          message: 'GET /api/orders 500',
          statusCode: 500,
        })
      ),
      true
    );
    assert.equal(
      isErrorEvent(
        normalizeVercelLogEvent({
          level: 'error',
          message: 'Unhandled exception in route handler',
        })
      ),
      true
    );
  });

  it('ignores firewall blocks that never reached application code', () => {
    const groups = groupErrorEvents([
      {
        deploymentId: 'dpl_test',
        level: 'error',
        message: '',
        requestId: 'request-test',
        route: '/api/cron/agentic-commerce-health',
        source: 'firewall',
        statusCode: 403,
      },
    ]);

    assert.deepEqual(groups, []);
  });

  it('builds stable fingerprints across ids and line numbers', () => {
    const left = normalizeVercelLogEvent({
      message:
        'TypeError: Cannot read properties of undefined at route.ts:42 request req_123',
      route: '/api/orders/123',
      deploymentId: 'dpl_one',
    });
    const right = normalizeVercelLogEvent({
      message:
        'TypeError: Cannot read properties of undefined at route.ts:99 request req_999',
      route: '/api/orders/456',
      deploymentId: 'dpl_two',
    });

    assert.equal(fingerprintErrorEvent(left), fingerprintErrorEvent(right));
  });

  it('does not invent a new observation time for timestamp-free drain data', () => {
    assert.equal(
      normalizeVercelLogEvent({ level: 'error', message: 'Error: stable' })
        .timestamp,
      ''
    );
  });

  it('normalizes numeric and string timestamps to ISO observations', () => {
    assert.equal(
      normalizeVercelLogEvent({ timestamp: 1_775_563_200_000 }).timestamp,
      '2026-04-07T12:00:00.000Z'
    );
    assert.equal(
      normalizeVercelLogEvent({ timestamp: '2026-08-04T16:46:50+01:00' })
        .timestamp,
      '2026-08-04T15:46:50.000Z'
    );
  });

  it('skips out-of-range numeric timestamps instead of throwing', () => {
    assert.equal(
      normalizeVercelLogEvent({
        timestamp: Number.MAX_VALUE,
        time: '2026-08-04T15:46:50Z',
      }).timestamp,
      '2026-08-04T15:46:50.000Z'
    );
  });

  it('does not let empty timestamps replace observed group bounds', () => {
    const [group] = groupErrorEvents([
      { level: 'error', message: 'Error: stable', timestamp: '' },
      {
        level: 'error',
        message: 'Error: stable',
        timestamp: '2026-08-04T15:46:50Z',
      },
      { level: 'error', message: 'Error: stable', timestamp: '' },
    ]);

    assert.equal(group.firstSeen, '2026-08-04T15:46:50.000Z');
    assert.equal(group.lastSeen, '2026-08-04T15:46:50.000Z');
  });

  it('groups repeated errors and selects candidates over the threshold', () => {
    const groups = groupErrorEvents([
      {
        level: 'error',
        message: 'Error: checkout failed',
        route: '/api/payments/verify',
      },
      {
        level: 'error',
        message: 'Error: checkout failed',
        route: '/api/payments/verify',
      },
      { level: 'info', message: 'GET / 200', route: '/' },
    ]);
    const candidates = selectRemediationCandidates(groups, {
      minOccurrences: 2,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].occurrences, 2);
    assert.equal(candidates[0].sample.route, '/api/payments/verify');
  });

  it('separates runtime exceptions, timeouts, and HTTP 5xx candidates', () => {
    const candidates = selectRemediationCandidates(
      groupErrorEvents([
        { level: 'error', message: 'Unhandled exception', route: '/runtime' },
        { level: 'error', message: 'Unhandled exception', route: '/runtime' },
        { level: 'error', message: 'Function timed out', route: '/timeout' },
        { level: 'error', message: 'Function timed out', route: '/timeout' },
        {
          level: 'info',
          message: 'GET /health 503',
          route: '/health',
          statusCode: 503,
        },
        {
          level: 'info',
          message: 'GET /health 503',
          route: '/health',
          statusCode: 503,
        },
      ]),
      { minOccurrences: 2 }
    );

    assert.deepEqual(candidates.map((candidate) => candidate.category).sort(), [
      'vercel_http_5xx',
      'vercel_runtime_exception',
      'vercel_timeout',
    ]);
    assert.equal(
      candidates.every((candidate) => candidate.source === 'vercel'),
      true
    );
  });

  it('does not merge same-fingerprint events from distinct Vercel categories', () => {
    const candidates = selectRemediationCandidates(
      groupErrorEvents([
        { level: 'error', message: 'Error: request failed', route: '/orders' },
        {
          level: 'info',
          message: 'Error: request failed',
          route: '/orders',
          statusCode: 500,
        },
      ]),
      { minOccurrences: 1 }
    );

    assert.deepEqual(candidates.map((candidate) => candidate.category).sort(), [
      'vercel_http_5xx',
      'vercel_runtime_exception',
    ]);
  });
});
