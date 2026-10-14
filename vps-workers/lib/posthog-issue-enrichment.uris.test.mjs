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
    issueId: '01961f15-9db7-4b9c-9c1a-51e2b823a003',
    message: 'TypeError',
    route: '(redacted PostHog location)',
    source: 'posthog',
  },
};

const enrichDetail = (detail, overrides = {}) =>
  enrichPostHogRemediationCandidate({
    candidate,
    env: environment,
    fetchFn: async () => new Response(JSON.stringify(detail)),
    ...overrides,
  });

describe('PostHog enrichment frame URIs', () => {
  it('preserves virtual sourcemap paths while reducing deployment URLs', async () => {
    const virtual = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 42,
        source: 'webpack:///./apps/web/src/app/api/orders/route.ts',
      },
    });
    assert.equal(
      virtual.sample.route,
      'apps/web/src/app/api/orders/route.ts:42'
    );

    const fileUrl = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 7,
        source: 'file:///etc/app/route.ts',
      },
    });
    assert.equal(fileUrl.sample.route, 'route.ts:7');

    const upperScheme = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 2,
        source: 'WEBPACK:///./src/top.js',
      },
    });
    assert.equal(upperScheme.sample.route, 'src/top.js:2');

    const namespaced = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 3,
        source: 'webpack:///src/app/route.ts',
      },
    });
    assert.equal(namespaced.sample.route, 'src/app/route.ts:3');
  });

  it('reduces virtual schemes around absolute local paths to basenames', async () => {
    for (const source of [
      'webpack:///Users/AliceSmith/ClientA/app.js',
      'webpack://app/./home/deploy/app/route.ts',
      'webpack:///C%3A/Users/AliceSmith/Client/app.js',
      'webpack:///%55sers/AliceSmith/Client/app.js',
      'webpack:////server/share/AliceSmith/Client/app.js',
      'webpack:///workspace/AliceSmith/Client/app.js',
      'webpack:///builds/merchant-123/Baci/app.js',
    ]) {
      const enriched = await enrichDetail({
        top_in_app_frame: {
          function: 'handleCheckout',
          line: 5,
          source,
        },
      });
      assert.equal(enriched.sample.route.includes('AliceSmith'), false, source);
      assert.equal(enriched.sample.route.includes('ClientA'), false, source);
      assert.equal(enriched.sample.route.includes('deploy'), false, source);
      assert.equal(
        enriched.sample.route.includes('merchant-123'),
        false,
        source
      );
      assert.equal(enriched.sample.route.includes('Baci'), false, source);
      assert.match(enriched.sample.route, /\.js:5$|\.ts:5$/);
    }
  });

  it('rejects non-hierarchical frame URIs while keeping node internals', async () => {
    const data = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        line: 1,
        source:
          'data:text/javascript;base64,QWxpY2VTbWl0aF9jdXN0b21lcl9wYXlsb2Fk',
      },
    });
    assert.equal(data.sample.route, '(redacted PostHog location)');
    assert.equal(
      data.sample.route.includes('QWxpY2VTbWl0aF9jdXN0b21lcl9wYXlsb2Fk'),
      false
    );

    const builtin = await enrichDetail({
      top_in_app_frame: {
        function: 'readFileSync',
        line: 123,
        source: 'node:fs',
      },
    });
    assert.equal(builtin.sample.route, 'node:fs:123');
  });

  it('validates node: sources against builtin module names', async () => {
    const subpath = await enrichDetail({
      top_in_app_frame: {
        function: 'test',
        line: 7,
        source: 'node:test/reporters',
      },
    });
    assert.equal(subpath.sample.route, 'node:test/reporters:7');

    const arbitrary = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        line: 1,
        source: 'node:AliceSmith_customer',
      },
    });
    assert.equal(arbitrary.sample.route, '(redacted PostHog location)');
    assert.equal(arbitrary.sample.route.includes('AliceSmith_customer'), false);

    const traversal = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        line: 1,
        source: 'node:fs/../etc/passwd',
      },
    });
    assert.equal(traversal.sample.route, '(redacted PostHog location)');
  });

  it('rejects unsupported hierarchical URI schemes', async () => {
    const blob = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        line: 1,
        source: 'blob:https://example.com/AliceSmith_customer',
      },
    });
    assert.equal(blob.sample.route, '(redacted PostHog location)');
    assert.equal(blob.sample.route.includes('AliceSmith_customer'), false);

    const encodedScheme = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 9,
        source: 'https%3A//cdn.example/app.js',
      },
    });
    assert.equal(encodedScheme.sample.route, 'app.js:9');
    assert.equal(encodedScheme.sample.route.includes('cdn.example'), false);
  });
});
