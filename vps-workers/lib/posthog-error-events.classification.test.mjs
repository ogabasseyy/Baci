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
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00a',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: "TypeError: Cannot read properties of undefined (reading 'token')",
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00b',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'request to https://internal.example timed out after 30s',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00c',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: '!!! alice@example.com !!!',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00d',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'AliceSmithError: custom producer token',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00e',
                status: 'active',
                aggregations: { occurrences: 4 },
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a00f',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'NonfatalError: invalid cart state',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a010',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'HeapifyError: sort failed',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a011',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'Failure in heap snapshot upload',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a012',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'JavaScript heap out of memory',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a013',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'UntimedOutputError: render failed',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a014',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'InternetworkError: render failed',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a015',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'fetch failed: socket hang up',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a016',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'Layout of memory panel failed',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a017',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'ParserError: cannot read properties of foo',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a018',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: "ParserError: cannot read property 'id' of foo",
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a019',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'ParserError: cannot read proprietary image format',
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a020',
                status: 'active',
                aggregations: { occurrences: 4 },
                name: 'ParserError: cannot read propertarian manifest',
              },
            ],
          })
        ),
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.sample.message),
      [
        'TypeError',
        'Timeout',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'Out of memory',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
        'Network failure',
        'PostHog error tracking issue',
        'Null reference',
        'Null reference',
        'PostHog error tracking issue',
        'PostHog error tracking issue',
      ]
    );
    assert.equal(
      JSON.stringify(candidates).includes('AliceSmithError'),
      false
    );
    assert.equal(JSON.stringify(candidates).includes('alice@example.com'), false);
    assert.equal(JSON.stringify(candidates).includes('internal.example'), false);
  });

});
