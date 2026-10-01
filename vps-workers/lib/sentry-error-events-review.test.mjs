import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichSentryRemediationCandidate } from './sentry-error-events.mjs';

const environment = {
  SENTRY_ORG: 'ogabassey',
  SENTRY_PROJECT: 'storefront',
  SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
};

const candidate = {
  fingerprint: 'candidate',
  occurrences: 2,
  sample: { issueId: 'issue-1', route: 'MainActivity', source: 'sentry' },
};

describe('Sentry event enrichment review regressions', () => {
  it('uses the organization-scoped latest-event endpoint', async () => {
    let requestedUrl;

    await enrichSentryRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({ entries: [] }));
      },
    });

    assert.equal(
      requestedUrl,
      'https://sentry.io/api/0/organizations/ogabassey/issues/issue-1/events/latest/'
    );
  });

  it('rejects a non-HTTPS Sentry URL before authorizing a request', async () => {
    let requested = false;

    await assert.rejects(
      enrichSentryRemediationCandidate({
        candidate,
        env: { ...environment, SENTRY_URL: 'http://sentry.invalid' },
        fetchFn: () => {
          requested = true;
          throw new Error('must not request');
        },
      }),
      /SENTRY_URL must use https/
    );

    assert.equal(requested, false);
  });

  it('reports a latest-event 429 without exposing a response body', async () => {
    await assert.rejects(
      enrichSentryRemediationCandidate({
        candidate,
        env: environment,
        fetchFn: async () => new Response('provider secret', { status: 429 }),
      }),
      (error) => {
        assert.match(
          error.message,
          /Sentry latest-event request failed with HTTP 429/
        );
        assert.doesNotMatch(error.message, /provider secret/);
        return true;
      }
    );
  });

  it('keeps the existing route when an event has no usable culprit or entries', async () => {
    const enriched = await enrichSentryRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(JSON.stringify({ culprit: '/private/42', entries: [] })),
    });

    assert.equal(enriched.sample.route, 'MainActivity');
    assert.deepEqual(enriched.sample.stackSummary, []);
  });

  it('ignores object-shaped event tags while enriching a candidate', async () => {
    const enriched = await enrichSentryRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({ entries: [], tags: { device: 'Pixel' } })
        ),
    });

    assert.equal(enriched.sample.route, 'MainActivity');
    assert.equal(enriched.sample.device, '');
  });
});
