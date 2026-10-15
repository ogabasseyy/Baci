import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchPostHogRemediationCandidates } from './posthog-error-events.mjs';

const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

describe('PostHog remediation candidates', () => {
  it('returns bounded error-tracking metadata without provider issue text', async () => {
    const candidates = await fetchPostHogRemediationCandidates({
      env: { ...environment, BACI_POSTHOG_REMEDIATION_MAX_PAGES: '2' },
      fetchFn: (url, options) => {
        assert.equal(
          String(url),
          'https://eu.posthog.com/api/projects/202711/error_tracking/query/issues/'
        );
        assert.equal(options.method, 'POST');
        assert.equal(
          options.headers.Authorization,
          'Bearer phx_read_only_personal_key'
        );
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(options.body), {
          dateRange: { date_from: '-7d' },
          filterTestAccounts: true,
          limit: 100,
          offset: 0,
          orderBy: 'occurrences',
          orderDirection: 'DESC',
          status: 'active',
          volumeResolution: 0,
        });
        return new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 0,
            results: [
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a018',
                status: 'active',
                aggregations: { occurrences: 4 },
                first_seen: '2026-08-04T15:45:25Z',
                last_seen: '2026-08-04T15:46:50Z',
                name: 'Crash for alice@example.com token=secret-value',
                description: 'customer 2348012345678 must-not-be-copied',
              },
            ],
          })
        );
      },
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sample.source, 'posthog');
    assert.equal(candidates[0].category, 'posthog_issue');
    assert.equal(candidates[0].sample.message, 'Native crash');
    assert.equal(candidates[0].sample.route, '(redacted PostHog location)');
    assert.equal(candidates[0].firstSeen, '2026-08-04T15:45:25.000Z');
    assert.equal(candidates[0].lastSeen, '2026-08-04T15:46:50.000Z');
    assert.equal(
      JSON.stringify(candidates).includes('alice@example.com'),
      false
    );
    assert.equal(JSON.stringify(candidates).includes('secret-value'), false);
    assert.equal(JSON.stringify(candidates).includes('2348012345678'), false);
  });

  it('rejects the public ingestion key and incomplete dedicated configuration', async () => {
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: {
          ...environment,
          POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phc_public_ingestion_key',
        },
        fetchFn: () => {
          throw new Error('fetch must not run with an ingestion key');
        },
      }),
      /personal API key.*not a project ingestion key/i
    );
    await assert.rejects(
      fetchPostHogRemediationCandidates({ env: {} }),
      /POSTHOG_REMEDIATION_HOST/
    );
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: {
          ...environment,
          POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'sk-generic-automation-token',
        },
        fetchFn: () => {
          throw new Error('fetch must not run with a non-personal key');
        },
      }),
      /must be a personal API key \(phx_\.\.\.\)/
    );
  });

  it('normalizes offset-form provider timestamps instead of dropping them', async () => {
    const candidates = await fetchPostHogRemediationCandidates({
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 0,
            results: [
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a005',
                status: 'active',
                aggregations: { occurrences: 4 },
                first_seen: '2026-08-04T15:45:25+00:00',
                last_seen: '2026-08-04T17:46:50+02:00',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a002',
                status: 'active',
                aggregations: { occurrences: 4 },
                first_seen: '2026-08-04T15:45:25',
                last_seen: 'not-a-timestamp',
              },
            ],
          })
        ),
    });

    assert.equal(candidates[0].firstSeen, '2026-08-04T15:45:25.000Z');
    assert.equal(candidates[0].lastSeen, '2026-08-04T15:46:50.000Z');
    assert.equal(candidates[1].firstSeen, '');
    assert.equal(candidates[1].lastSeen, '');
  });

  it('drops impossible calendar dates instead of rolling them over', async () => {
    const candidates = await fetchPostHogRemediationCandidates({
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 0,
            results: [
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a016',
                status: 'active',
                aggregations: { occurrences: 4 },
                first_seen: '2026-02-31T10:00:00Z',
                last_seen: '2026-02-31T10:00:00Z',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a017',
                status: 'active',
                aggregations: { occurrences: 4 },
                first_seen: '2024-02-29T10:00:00Z',
                last_seen: '2024-02-29T10:00:00Z',
              },
            ],
          })
        ),
    });

    assert.equal(candidates[0].firstSeen, '');
    assert.equal(candidates[0].lastSeen, '');
    assert.equal(candidates[1].firstSeen, '2024-02-29T10:00:00.000Z');
    assert.equal(candidates[1].lastSeen, '2024-02-29T10:00:00.000Z');
  });

  it('judges fractional occurrence aggregates against the repeat threshold', async () => {
    const candidates = await fetchPostHogRemediationCandidates({
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 0,
            results: [
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a007',
                status: 'active',
                aggregations: { occurrences: 4.5 },
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a009',
                status: 'active',
                aggregations: { occurrences: 1.9 },
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a008',
                status: 'active',
                aggregations: { occurrences: 2.0 },
              },
            ],
          })
        ),
    });

    assert.equal(candidates.length, 2);
    assert.equal(
      candidates[0].sample.issueId,
      '01961f15-9db7-4b9c-9c1a-51e2b823a007'
    );
    assert.equal(candidates[0].occurrences, 4);
    assert.equal(
      candidates[1].sample.issueId,
      '01961f15-9db7-4b9c-9c1a-51e2b823a008'
    );
    assert.equal(candidates[1].occurrences, 2);
  });

  it('reports a provider response that is not JSON', async () => {
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: environment,
        fetchFn: async () => new Response('<html>proxy error</html>'),
      }),
      /PostHog error-tracking issues response was invalid JSON/
    );
  });

  it('does not promote a provider issue identifier that could contain personal data', async () => {
    const candidates = await fetchPostHogRemediationCandidates({
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 0,
            results: [
              {
                id: 'alice@example.com',
                status: 'active',
                aggregations: { occurrences: 4 },
              },
            ],
          })
        ),
    });

    assert.deepEqual(candidates, []);
  });

  it('reports the read scope without exposing provider response bodies', async () => {
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: environment,
        fetchFn: async () => new Response('provider-secret', { status: 403 }),
      }),
      /HTTP 403; POSTHOG_REMEDIATION_PERSONAL_API_KEY requires error_tracking:read/
    );
  });

  it('rejects a remediation host with a path and strips query strings', async () => {
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: {
          ...environment,
          POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com/some/app',
        },
        fetchFn: () => {
          throw new Error('fetch must not run with a pathed host');
        },
      }),
      /must not include a path/
    );

    let requestedUrl = '';
    await fetchPostHogRemediationCandidates({
      env: {
        ...environment,
        POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com/?debug=1#frag',
      },
      fetchFn: (url) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({ hasMore: false, results: [] })
        );
      },
    });
    assert.equal(
      requestedUrl,
      'https://eu.posthog.com/api/projects/202711/error_tracking/query/issues/'
    );
  });
});
