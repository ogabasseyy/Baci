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
                id: 'issue-987',
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
    assert.equal(candidates[0].firstSeen, '2026-08-04T15:45:25Z');
    assert.equal(candidates[0].lastSeen, '2026-08-04T15:46:50Z');
    assert.equal(
      JSON.stringify(candidates).includes('alice@example.com'),
      false
    );
    assert.equal(JSON.stringify(candidates).includes('secret-value'), false);
    assert.equal(JSON.stringify(candidates).includes('2348012345678'), false);
  });

  it('follows the official nextOffset cursor before applying the repeat threshold', async () => {
    const requestedUrls = [];
    const candidates = await fetchPostHogRemediationCandidates({
      env: { ...environment, BACI_POSTHOG_REMEDIATION_MAX_PAGES: '2' },
      fetchFn: (url, options) => {
        requestedUrls.push(String(url));
        const request = JSON.parse(options.body);
        if (requestedUrls.length === 1) {
          assert.equal(request.offset, 0);
          return new Response(
            JSON.stringify({
              hasMore: true,
              limit: 100,
              nextOffset: 23,
              offset: 0,
              results: [
                {
                  id: 'one-off',
                  status: 'active',
                  aggregations: { occurrences: 1 },
                },
              ],
            })
          );
        }
        assert.equal(request.offset, 23);
        return new Response(
          JSON.stringify({
            hasMore: false,
            limit: 100,
            offset: 23,
            results: [
              {
                id: 'repeated',
                status: 'active',
                aggregations: { occurrences: 8 },
              },
            ],
          })
        );
      },
    });

    assert.equal(requestedUrls.length, 2);
    assert.equal(
      requestedUrls[1],
      'https://eu.posthog.com/api/projects/202711/error_tracking/query/issues/'
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].occurrences, 8);
  });

  it('fails closed when the configured page ceiling would leave issues unmeasured', async () => {
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: { ...environment, BACI_POSTHOG_REMEDIATION_MAX_PAGES: '1' },
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              hasMore: true,
              limit: 100,
              nextOffset: 1,
              offset: 0,
              results: [
                {
                  id: 'first',
                  status: 'active',
                  aggregations: { occurrences: 2 },
                },
              ],
            })
          ),
      }),
      /pagination exceeded 1 pages/
    );
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

  it('derives a bounded exception class without copying provider issue text', async () => {
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
                id: 'typed',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: "TypeError: Cannot read properties of undefined (reading 'token')",
              },
              {
                id: 'bucketed',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'request to https://internal.example timed out after 30s',
              },
              {
                id: 'unshaped',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: '!!! alice@example.com !!!',
              },
              {
                id: 'missing-name',
                status: 'active',
                aggregations: { occurrences: 4 },
              },
            ],
          })
        ),
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.sample.message),
      ['TypeError', 'Timeout', 'PostHog error tracking issue', 'PostHog error tracking issue']
    );
    assert.equal(JSON.stringify(candidates).includes('alice@example.com'), false);
    assert.equal(JSON.stringify(candidates).includes('internal.example'), false);
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

  it('pages to the hard cap by default before failing closed', async () => {
    let requests = 0;
    await assert.rejects(
      fetchPostHogRemediationCandidates({
        env: environment,
        fetchFn: async () => {
          requests += 1;
          return new Response(
            JSON.stringify({
              hasMore: true,
              limit: 100,
              nextOffset: requests,
              offset: requests - 1,
              results: [],
            })
          );
        },
      }),
      /exceeded the 10-page hard cap/
    );
    assert.equal(requests, 10);
  });
});
