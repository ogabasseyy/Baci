import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichPostHogRemediationCandidate } from './posthog-issue-enrichment.mjs';

const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

const candidate = {
  category: 'posthog_issue',
  fingerprint: 'posthog-abc123',
  occurrences: 4,
  sample: {
    issueId: '01961f15-9db7-4b9c-9c1a-51e2b823a003',
    message: 'TypeError',
    route: '(redacted PostHog location)',
    source: 'posthog',
  },
};

const enrichDetail = (detail, overrides = {}) =>
  enrichPostHogRemediationCandidate({
    candidate,
    env: environment,
    fetchFn: async () => new Response(JSON.stringify(detail)),
    ...overrides,
  });

describe('PostHog remediation candidate enrichment', () => {
  it('adds a sanitized frame coordinate and release to the sample', async () => {
    const enriched = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: (url, options) => {
        assert.equal(
          String(url),
          'https://eu.posthog.com/api/projects/202711/error_tracking/query/issue/'
        );
        assert.deepEqual(JSON.parse(options.body), {
          dateRange: { date_from: '-7d' },
          filterTestAccounts: true,
          issueId: '01961f15-9db7-4b9c-9c1a-51e2b823a003',
          volumeResolution: 0,
        });
        return new Response(
          JSON.stringify({
            latest_release: { version: '2026.10.1' },
            top_in_app_frame: {
              function: 'handleCheckout',
              in_app: true,
              line: 42,
              source: 'apps/web/checkout.py',
            },
          })
        );
      },
    });

    assert.equal(enriched.sample.route, 'apps/web/checkout.py:42');
    assert.equal(enriched.sample.release, '2026.10.1');
    assert.equal(enriched.sample.message, 'TypeError');
    assert.equal(enriched.fingerprint, 'posthog-abc123');
  });

  it('drops URL query metadata and non-canonical releases from the sample', async () => {
    const enriched = await enrichDetail({
      latest_release: { version: 'release for AliceSmith (build 42)' },
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 7,
        source: 'app.js?user=AliceSmith&account=merchant-123',
      },
    });

    assert.equal(enriched.sample.route, 'app.js:7');
    assert.equal(enriched.sample.route.includes('AliceSmith'), false);
    assert.equal(enriched.sample.route.includes('merchant-123'), false);
    assert.equal(enriched.sample.release, undefined);
  });

  it('drops phone-shaped and bare-name release values', async () => {
    for (const version of ['08031234567', 'AliceSmith', 'v2']) {
      const enriched = await enrichDetail({
        latest_release: { version },
        top_in_app_frame: { function: 'handleCheckout', source: 'app.js' },
      });
      assert.equal(enriched.sample.release, undefined, version);
    }
  });

  it('drops hexadecimal commit identifiers even at full SHA length', async () => {
    for (const version of [
      'abc1234def5678',
      'd34db33fd34db33fd34db33fd34db33f',
      'a'.repeat(40),
      'b'.repeat(64),
    ]) {
      const dropped = await enrichDetail({
        latest_release: { version },
        top_in_app_frame: { function: 'f', source: 'a.js' },
      });
      assert.equal(dropped.sample.release, undefined, version);
    }
  });

  it('rejects dotted release values that are not canonical versions', async () => {
    for (const version of [
      'Alice.Smith',
      '0803.123.4567',
      'sk.secretvalue123456789',
    ]) {
      const enriched = await enrichDetail({
        latest_release: { version },
        top_in_app_frame: { function: 'f', source: 'a.js' },
      });
      assert.equal(enriched.sample.release, undefined, version);
    }
  });

  it('truncates prerelease suffixes to the semver core', async () => {
    for (const [version, expected] of [
      ['2.0.0-rc.1', '2.0.0'],
      ['1.2.3-AliceSmith', '1.2.3'],
    ]) {
      const enriched = await enrichDetail({
        latest_release: { version },
        top_in_app_frame: { function: 'f', source: 'a.js' },
      });
      assert.equal(enriched.sample.release, expected, version);
    }
  });

  it('keeps the redacted route when the detail has no usable frame', async () => {
    const enriched = await enrichDetail({ latest_release: {} });

    assert.equal(enriched.sample.route, '(redacted PostHog location)');
    assert.equal(enriched.sample.release, undefined);
  });

  it('rejects an unsafe issue ID before any network request', async () => {
    await assert.rejects(
      enrichDetail(
        {},
        {
          candidate: {
            ...candidate,
            sample: { ...candidate.sample, issueId: 'alice@example.com' },
          },
          fetchFn: () => {
            throw new Error('fetch must not run with an unsafe issue ID');
          },
        }
      ),
      /requires a safe issue ID/
    );
  });

  it('reports provider failures without leaking response bodies', async () => {
    await assert.rejects(
      enrichPostHogRemediationCandidate({
        candidate,
        env: environment,
        fetchFn: async () => new Response('provider-secret', { status: 403 }),
      }),
      /HTTP 403; POSTHOG_REMEDIATION_PERSONAL_API_KEY requires error_tracking:read/
    );
    await assert.rejects(
      enrichPostHogRemediationCandidate({
        candidate,
        env: environment,
        fetchFn: async () => new Response('<html>proxy error</html>'),
      }),
      /PostHog error-tracking issue response was invalid JSON/
    );
  });

  // Provider-shaped fixture: mirrors ErrorTrackingIssueDetailSerializer in
  // posthog/api/error_tracking/error_tracking_serializers.py — the detail
  // response extends the list item with function, top_in_app_frame,
  // latest_release, impact, sparkline, and breakdown. Enrichment reads only
  // the frame coordinate and release version and ignores the rest.
  it('reads a full provider-shaped issue detail without copying extra fields', async () => {
    const enriched = await enrichDetail({
      id: '01961f15-9db7-4b9c-9c1a-51e2b823a003',
      name: "TypeError: Cannot read properties of null (reading 'id')",
      description: 'full description stays provider-side',
      status: 'active',
      severity: 'high',
      first_seen: '2026-08-04T15:45:25Z',
      last_seen: '2026-08-04T15:46:50Z',
      library: 'posthog-js',
      source: 'checkout.js',
      assignee: { id: '7', type: 'user' },
      aggregations: { occurrences: 12, users: 5, sessions: 9 },
      function: 'handleCheckout',
      top_in_app_frame: {
        function: 'handleCheckout',
        source: 'apps/web/checkout.py',
        line: 42,
        column: 7,
        in_app: true,
      },
      latest_release: {
        version: '2026.10.1',
        project: 'baci-web',
        timestamp: '2026-10-01T00:00:00Z',
        commit_id: 'd34db33fd34db33fd34db33fd34db33fd34db33f',
        branch: 'main',
        repo_name: 'baci',
      },
      impact: { occurrences: 12, users: 5, sessions: 9 },
      sparkline: [1, 4, 7],
      breakdown: {
        date_from: '2026-08-01T00:00:00Z',
        date_to: '2026-08-04T00:00:00Z',
        range_limited: false,
        occurrences: 12,
        sample_session_ids: ['session-1'],
        top_values: { path: [{ value: '/checkout', count: 9 }] },
      },
      future_provider_field: 'ignore-me',
    });

    assert.equal(enriched.sample.route, 'apps/web/checkout.py:42');
    assert.equal(enriched.sample.release, '2026.10.1');
    assert.equal(enriched.sample.message, 'TypeError');
    const serialized = JSON.stringify(enriched);
    assert.equal(serialized.includes('ignore-me'), false);
    assert.equal(serialized.includes('session-1'), false);
    assert.equal(serialized.includes('d34db33f'), false);
    assert.equal(serialized.includes('full description'), false);
  });
});
