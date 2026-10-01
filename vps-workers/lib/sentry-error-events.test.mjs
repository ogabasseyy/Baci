import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchSentryRemediationCandidates } from './sentry-error-events.mjs';

const environment = {
  SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
  SENTRY_ORG: 'ogabassey',
  SENTRY_PROJECT: 'storefront',
};

describe('Sentry remediation candidates', () => {
  it('returns bounded issue metadata without event payloads or users', async () => {
    const candidates = await fetchSentryRemediationCandidates({
      env: environment,
      fetchFn: (url, options) => {
        assert.match(String(url), /query=is%3Aunresolved/);
        assert.equal(options.headers.Authorization, 'Bearer token');
        return new Response(
          JSON.stringify([
            {
              id: '987',
              count: '4',
              title: 'Application Not Responding',
              culprit: 'com.ogabassey.store.MainActivity',
              firstSeen: '2026-08-04T15:45:25Z',
              lastSeen: '2026-08-04T15:46:50Z',
              lastRelease: { version: 'com.ogabassey.store@2.0.1+761' },
              user: { email: 'must-not-be-copied@example.com' },
            },
          ])
        );
      },
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sample.source, 'sentry');
    assert.equal(candidates[0].source, 'sentry');
    assert.equal(candidates[0].category, 'sentry_issue');
    assert.equal(candidates[0].sample.organization, 'ogabassey');
    assert.equal(candidates[0].sample.project, 'storefront');
    assert.equal(candidates[0].sample.message, 'Application Not Responding');
    assert.equal('user' in candidates[0].sample, false);
    assert.equal(
      JSON.stringify(candidates).includes('must-not-be-copied'),
      false
    );
  });

  it('fails closed when credentials are incomplete', async () => {
    await assert.rejects(
      fetchSentryRemediationCandidates({ env: {} }),
      /SENTRY_REMEDIATION_AUTH_TOKEN/
    );
  });

  it('ignores one-off issues unless the operator lowers the threshold', async () => {
    const response = () =>
      new Response(JSON.stringify([{ id: 'one-off', count: '1' }]));

    assert.deepEqual(
      await fetchSentryRemediationCandidates({
        env: environment,
        fetchFn: response,
      }),
      []
    );
    assert.equal(
      (
        await fetchSentryRemediationCandidates({
          env: { ...environment, BACI_REMEDIATION_MIN_OCCURRENCES: '1' },
          fetchFn: response,
        })
      ).length,
      1
    );
  });

  it('does not serialize sensitive provider-controlled issue text', async () => {
    const candidates = await fetchSentryRemediationCandidates({
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify([
            {
              id: 'sensitive-1',
              count: '2',
              title: 'Crash for alice@example.com token=secret-value',
              culprit: '/users/alice/private/customer-2348012345678',
              lastSeen: '2026-08-04T15:46:50Z',
            },
          ])
        ),
    });
    const serialized = JSON.stringify(candidates);

    assert.equal(candidates[0].sample.message, 'Sentry mobile issue');
    assert.equal(candidates[0].sample.route, '(redacted native location)');
    assert.equal(serialized.includes('alice'), false);
    assert.equal(serialized.includes('secret-value'), false);
    assert.equal(serialized.includes('2348012345678'), false);
  });

  it('does not expose provider response bodies on HTTP failure', async () => {
    await assert.rejects(
      fetchSentryRemediationCandidates({
        env: environment,
        fetchFn: async () => new Response('secret body', { status: 503 }),
      }),
      /HTTP 503/
    );
  });

  it('explores later issue pages before applying the repeat threshold', async () => {
    const requestedUrls = [];
    const candidates = await fetchSentryRemediationCandidates({
      env: environment,
      fetchFn: (url) => {
        requestedUrls.push(String(url));
        if (requestedUrls.length === 1) {
          return new Response(
            JSON.stringify([{ id: 'new-one-off', count: '1' }]),
            {
              headers: {
                Link: `<${String(url)}&cursor=next>; rel="next"; results="true"; cursor="next"`,
              },
            }
          );
        }
        return new Response(
          JSON.stringify([
            { id: 'older-repeated-anr', count: '8', title: 'ANR' },
          ]),
          {
            headers: {
              Link: `<${String(url)}>; rel="next"; results="false"; cursor="done"`,
            },
          }
        );
      },
    });

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /cursor=next/);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].occurrences, 8);
  });

  it('identifies the required read scope without exposing response bodies', async () => {
    await assert.rejects(
      fetchSentryRemediationCandidates({
        env: environment,
        fetchFn: async () => new Response('provider-secret', { status: 403 }),
      }),
      /HTTP 403; SENTRY_REMEDIATION_AUTH_TOKEN requires event:read/
    );
  });
});
