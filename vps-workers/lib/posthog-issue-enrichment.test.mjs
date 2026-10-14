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
    issueId: 'posthog-issue-1',
    message: 'TypeError',
    route: '(redacted PostHog location)',
    source: 'posthog',
  },
};

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
          issueId: 'posthog-issue-1',
          volumeResolution: 0,
        });
        return new Response(
          JSON.stringify({
            function: 'handleCheckout',
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

    assert.equal(
      enriched.sample.route,
      'apps/web/checkout.py :: handleCheckout:42'
    );
    assert.equal(enriched.sample.release, '2026.10.1');
    assert.equal(enriched.sample.message, 'TypeError');
    assert.equal(enriched.fingerprint, 'posthog-abc123');
  });

  it('redacts identifiers in frame metadata before character filtering', async () => {
    const enriched = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            latest_release: { version: '2026.10.1' },
            top_in_app_frame: {
              function: 'handleCheckout',
              line: 42,
              source:
                'checkout.py?email=alice@example.com&token=secret-value',
            },
          })
        ),
    });

    assert.match(enriched.sample.route, /handleCheckout/);
    assert.match(enriched.sample.route, /checkout\.py/);
    assert.equal(enriched.sample.route.includes('alice'), false);
    assert.equal(enriched.sample.route.includes('secret-value'), false);
    assert.equal(
      enriched.sample.route.includes('example.com'),
      false
    );
  });

  it('drops URL query metadata and non-canonical releases from the sample', async () => {
    const enriched = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            latest_release: { version: 'release for AliceSmith (build 42)' },
            top_in_app_frame: {
              function: 'handleCheckout',
              line: 7,
              source: 'app.js?user=AliceSmith&account=merchant-123',
            },
          })
        ),
    });

    assert.equal(
      enriched.sample.route,
      'app.js :: handleCheckout:7'
    );
    assert.equal(enriched.sample.route.includes('AliceSmith'), false);
    assert.equal(enriched.sample.route.includes('merchant-123'), false);
    assert.equal(enriched.sample.release, undefined);
  });

  it('strips URL credentials from frame sources entirely', async () => {
    const enriched = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            latest_release: { version: '2026.10.1' },
            top_in_app_frame: {
              function: 'handleCheckout',
              line: 11,
              source: 'https://deploy:somepassword@cdn.example/app.js',
            },
          })
        ),
    });

    assert.equal(enriched.sample.route, '/app.js :: handleCheckout:11');
    assert.equal(enriched.sample.route.includes('somepassword'), false);
    assert.equal(enriched.sample.route.includes('cdn.example'), false);
    assert.equal(enriched.sample.route.includes('deploy'), false);
  });

  it('drops phone-shaped and bare-name release values', async () => {
    for (const version of ['08031234567', 'AliceSmith', 'v2']) {
      const enriched = await enrichPostHogRemediationCandidate({
        candidate,
        env: environment,
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              latest_release: { version },
              top_in_app_frame: {
                function: 'handleCheckout',
                source: 'app.js',
              },
            })
          ),
      });
      assert.equal(enriched.sample.release, undefined, version);
    }

    const sha = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            latest_release: { version: 'abc1234def5678' },
            top_in_app_frame: { function: 'f', source: 'a.js' },
          })
        ),
    });
    assert.equal(sha.sample.release, 'abc1234def5678');
  });

  it('keeps the redacted route when the detail has no usable frame', async () => {
    const enriched = await enrichPostHogRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(JSON.stringify({ latest_release: {} })),
    });

    assert.equal(enriched.sample.route, '(redacted PostHog location)');
    assert.equal(enriched.sample.release, undefined);
  });

  it('rejects an unsafe issue ID before any network request', async () => {
    await assert.rejects(
      enrichPostHogRemediationCandidate({
        candidate: {
          ...candidate,
          sample: { ...candidate.sample, issueId: 'alice@example.com' },
        },
        env: environment,
        fetchFn: () => {
          throw new Error('fetch must not run with an unsafe issue ID');
        },
      }),
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
});
