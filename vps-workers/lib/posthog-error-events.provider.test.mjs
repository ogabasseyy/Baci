import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchPostHogRemediationCandidates } from './posthog-error-events.mjs';

// Provider-shaped fixture: mirrors the issue-list response contract from
// the PostHog source workspace:
// - posthog/api/error_tracking/error_tracking_serializers.py
//   (ErrorTrackingIssuesListResponseSerializer,
//   ErrorTrackingIssueListItemSerializer)
// - posthog/api/error_tracking/test/error_tracking.py (test_search_issues)
// It pins the loader against the provider's real field names, nullability,
// float counts, and the optional nextOffset — not against invented mocks.
const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

describe('PostHog remediation candidates provider contract', () => {
  it('accepts a provider-shaped payload with full, sparse, and ineligible rows', async () => {
    let calls = 0;
    const candidates = await fetchPostHogRemediationCandidates({
      env: environment,
      fetchFn: () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            results: [
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a021',
                name: "TypeError: Cannot read properties of null (reading 'id')",
                description: 'list rows carry only a short preview',
                status: 'active',
                severity: null,
                first_seen: '2026-08-04T15:45:25Z',
                last_seen: '2026-08-04T15:46:50Z',
                library: 'posthog-js',
                source: 'checkout.js',
                assignee: { id: '7', type: 'user' },
                aggregations: {
                  occurrences: 12.7,
                  users: 5,
                  sessions: 9,
                  volumeRange: [1, 2],
                  volume_buckets: [{ label: '2026-08-04', value: 12.7 }],
                },
                future_provider_field: { nested: true },
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a022',
                name: null,
                description: null,
                status: 'active',
                severity: null,
                first_seen: null,
                last_seen: null,
                library: null,
                source: null,
                assignee: null,
                aggregations: null,
              },
              {
                id: '01961f15-9db7-4b9c-9c1a-51e2b823a023',
                name: 'Resolved crash must not page',
                status: 'resolved',
                first_seen: '2026-08-01T00:00:00Z',
                last_seen: '2026-08-02T00:00:00Z',
                aggregations: { occurrences: 500 },
              },
            ],
            hasMore: false,
            limit: 100,
            offset: 0,
          })
        );
      },
    });

    assert.equal(calls, 1);
    assert.equal(candidates.length, 1);
    assert.equal(
      candidates[0].sample.issueId,
      '01961f15-9db7-4b9c-9c1a-51e2b823a021'
    );
    assert.equal(candidates[0].sample.message, 'TypeError');
    assert.equal(candidates[0].occurrences, 12);
    assert.equal(candidates[0].firstSeen, '2026-08-04T15:45:25.000Z');
    assert.equal(candidates[0].lastSeen, '2026-08-04T15:46:50.000Z');
    const serialized = JSON.stringify(candidates);
    assert.equal(serialized.includes('reading'), false);
    assert.equal(serialized.includes('a022'), false);
    assert.equal(serialized.includes('Resolved crash'), false);
    assert.equal(serialized.includes('future_provider_field'), false);
  });
});
