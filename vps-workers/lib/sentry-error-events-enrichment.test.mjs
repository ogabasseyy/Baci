import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichSentryRemediationCandidate } from './sentry-error-events.mjs';

const environment = {
  SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
  SENTRY_ORG: 'ogabassey',
  SENTRY_PROJECT: 'storefront',
};

describe('Sentry latest-event enrichment', () => {
  it('adds bounded technical evidence from the latest event without copying users', async () => {
    const candidate = {
      fingerprint: 'anr-fingerprint',
      occurrences: 3,
      sample: { issueId: '139588932', source: 'sentry' },
    };

    const enriched = await enrichSentryRemediationCandidate({
      candidate,
      env: environment,
      fetchFn: (url, options) => {
        assert.match(
          String(url),
          /\/organizations\/ogabassey\/issues\/139588932\/events\/latest\/$/
        );
        assert.equal(options.headers.Authorization, 'Bearer token');
        return new Response(
          JSON.stringify({
            contexts: {
              app: { in_foreground: false },
              device: { model: 'SM-A047F' },
              os: { name: 'Android', version: '14' },
            },
            entries: [
              {
                data: {
                  values: [
                    {
                      mechanism: { type: 'AppExitInfo' },
                      stacktrace: {
                        frames: [
                          {
                            function: 'drawGroup',
                            module: 'com.horcrux.svg.GroupView',
                          },
                          {
                            function: 'synchronouslyUpdateUIProps',
                            module: 'com.swmansion.reanimated.NativeProxy',
                          },
                        ],
                      },
                      type: 'ApplicationNotResponding',
                      value: 'Background ANR',
                    },
                  ],
                },
                type: 'exception',
              },
            ],
            platform: 'java',
            release: { version: 'com.ogabassey.store@2.0.1+766' },
            tags: [{ key: 'device.class', value: 'low' }],
            user: { email: 'must-not-be-copied@example.com' },
          })
        );
      },
    });

    assert.equal(enriched.sample.release, 'com.ogabassey.store@2.0.1+766');
    assert.equal(enriched.sample.platform, 'java');
    assert.equal(enriched.sample.appState, 'background');
    assert.equal(enriched.sample.device, 'SM-A047F');
    assert.equal(enriched.sample.deviceClass, 'low');
    assert.equal(enriched.sample.os, 'Android 14');
    assert.equal(enriched.sample.mechanism, 'AppExitInfo');
    assert.deepEqual(enriched.sample.stackSummary, [
      'com.horcrux.svg.GroupView.drawGroup',
      'com.swmansion.reanimated.NativeProxy.synchronouslyUpdateUIProps',
    ]);
    assert.equal(
      JSON.stringify(enriched).includes('must-not-be-copied'),
      false
    );
  });

  it('keeps the actionable tail of a long Sentry stack', async () => {
    const noiseFrames = Array.from({ length: 40 }, (_, index) => ({
      function: `noise${index}`,
      module: 'java.lang.Runtime',
    }));
    const enriched = await enrichSentryRemediationCandidate({
      candidate: {
        fingerprint: 'long-stack',
        occurrences: 3,
        sample: { issueId: 'long-stack-issue', source: 'sentry' },
      },
      env: environment,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            entries: [
              {
                data: {
                  values: [
                    {
                      stacktrace: {
                        frames: [
                          ...noiseFrames,
                          {
                            function: 'drawGroup',
                            module: 'com.horcrux.svg.GroupView',
                          },
                          {
                            function: 'synchronouslyUpdateUIProps',
                            module: 'com.swmansion.reanimated.NativeProxy',
                          },
                        ],
                      },
                    },
                  ],
                },
                type: 'exception',
              },
            ],
          })
        ),
    });

    assert.equal(enriched.sample.stackSummary.length, 32);
    assert.equal(
      enriched.sample.stackSummary.includes(
        'com.horcrux.svg.GroupView.drawGroup'
      ),
      true
    );
    assert.equal(
      enriched.sample.stackSummary.includes(
        'com.swmansion.reanimated.NativeProxy.synchronouslyUpdateUIProps'
      ),
      true
    );
  });

  it('does not expose a malformed latest-event response body', async () => {
    await assert.rejects(
      enrichSentryRemediationCandidate({
        candidate: {
          fingerprint: 'malformed-event',
          occurrences: 3,
          sample: { issueId: 'malformed-event', source: 'sentry' },
        },
        env: environment,
        fetchFn: async () =>
          new Response('customer alice@example.com provider secret'),
      }),
      (error) => {
        assert.match(
          error.message,
          /Sentry latest-event response was invalid JSON/
        );
        assert.doesNotMatch(
          error.message,
          /alice@example\.com|provider secret/
        );
        return true;
      }
    );
  });
});
