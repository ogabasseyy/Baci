import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchPostHogRemediationCandidates } from './posthog-error-events.mjs';

const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

describe('PostHog remediation candidate pagination', () => {
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
