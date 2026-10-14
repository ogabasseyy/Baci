import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchPostHogRemediationCandidates } from './posthog-error-events.mjs';

const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

describe('PostHog issue-name classification', () => {
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
                id: 'custom-token',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'AliceSmithError: custom producer token',
              },
              {
                id: 'missing-name',
                status: 'active',
                aggregations: { occurrences: 4 },
              },
              {
                id: 'substring-crash',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'NonfatalError: invalid cart state',
              },
              {
                id: 'substring-oom',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'HeapifyError: sort failed',
              },
            ],
          })
        ),
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.sample.message),
      ['TypeError', 'Timeout', 'PostHog error tracking issue', 'PostHog error tracking issue', 'PostHog error tracking issue', 'PostHog error tracking issue', 'PostHog error tracking issue']
    );
    assert.equal(
      JSON.stringify(candidates).includes('AliceSmithError'),
      false
    );
    assert.equal(JSON.stringify(candidates).includes('alice@example.com'), false);
    assert.equal(JSON.stringify(candidates).includes('internal.example'), false);
  });

});
