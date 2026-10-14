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

describe('PostHog enrichment frame paths', () => {
  it('redacts identifiers in frame metadata before character filtering', async () => {
    const enriched = await enrichDetail({
      latest_release: { version: '2026.10.1' },
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 42,
        source: 'checkout.py?email=alice@example.com&token=secret-value',
      },
    });

    assert.match(enriched.sample.route, /checkout\.py/);
    assert.equal(enriched.sample.route.includes('alice'), false);
    assert.equal(enriched.sample.route.includes('secret-value'), false);
    assert.equal(enriched.sample.route.includes('example.com'), false);
  });

  it('strips URL credentials from frame sources entirely', async () => {
    const enriched = await enrichDetail({
      latest_release: { version: '2026.10.1' },
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 11,
        source: 'https://deploy:somepassword@cdn.example/app.js',
      },
    });

    assert.equal(enriched.sample.route, 'app.js:11');
    assert.equal(enriched.sample.route.includes('somepassword'), false);
    assert.equal(enriched.sample.route.includes('cdn.example'), false);
    assert.equal(enriched.sample.route.includes('deploy'), false);
  });

  it('normalizes relative frame paths and fails traversal closed', async () => {
    const backslash = await enrichDetail({
      top_in_app_frame: {
        function: 'render',
        line: 3,
        source: 'src\\app\\route.ts',
      },
    });
    assert.equal(backslash.sample.route, 'src/app/route.ts:3');

    const traversal = await enrichDetail({
      top_in_app_frame: {
        function: 'render',
        line: 3,
        source: 'src/../../etc/route.ts',
      },
    });
    assert.equal(traversal.sample.route, 'route.ts:3');
  });

  it('resolves double-encoded delimiters before redaction', async () => {
    const query = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 11,
        source: 'app.js%253Fuser%253DAliceSmith',
      },
    });
    assert.equal(query.sample.route, 'app.js:11');
    assert.equal(query.sample.route.includes('AliceSmith'), false);

    const secret = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 3,
        source: 'token%253Dsecret-value.js',
      },
    });
    assert.equal(secret.sample.route.includes('secret-value'), false);
  });

  it('reduces relative paths with unrecognized roots to basenames', async () => {
    const customer = await enrichDetail({
      top_in_app_frame: {
        function: 'render',
        line: 12,
        source: 'customers/AliceSmith/app.js',
      },
    });
    assert.equal(customer.sample.route, 'app.js:12');
    assert.equal(customer.sample.route.includes('customers'), false);
    assert.equal(customer.sample.route.includes('AliceSmith'), false);

    const repoRoot = await enrichDetail({
      top_in_app_frame: {
        function: 'sync',
        line: 4,
        source: 'supabase/functions/sync-orders/index.ts',
      },
    });
    assert.equal(
      repoRoot.sample.route,
      'supabase/functions/sync-orders/index.ts:4'
    );
  });

  it('keeps only the basename of absolute local frame paths', async () => {
    for (const source of [
      '/Users/AliceSmith/ClientA/app.js',
      'C:\\Users\\AliceSmith\\ClientA\\app.js',
      '\\\\server\\share\\app.js',
      '  /Users/AliceSmith/app.js  ',
      '~/Users/AliceSmith/ClientA/app.js',
    ]) {
      const enriched = await enrichDetail({
        top_in_app_frame: { function: 'render', source },
      });
      assert.equal(enriched.sample.route, 'app.js', source);
      assert.equal(enriched.sample.route.includes('AliceSmith'), false);
      assert.equal(enriched.sample.route.includes('ClientA'), false);
    }

    const tildeUser = await enrichDetail({
      top_in_app_frame: {
        function: 'render',
        source: '~deploy/app/route.ts',
      },
    });
    assert.equal(tildeUser.sample.route, 'route.ts');
    assert.equal(tildeUser.sample.route.includes('deploy'), false);

    const driveRelative = await enrichDetail({
      top_in_app_frame: { function: 'render', source: 'C:app.js' },
    });
    assert.equal(driveRelative.sample.route, '(redacted PostHog location)');
  });

  it('redacts compact phone runs in frame metadata', async () => {
    const enriched = await enrichDetail({
      top_in_app_frame: {
        function: 'notify08031234567',
        source: 'dialer.js',
      },
    });

    assert.equal(enriched.sample.route.includes('08031234567'), false);
    assert.match(enriched.sample.route, /dialer\.js/);
  });

  it('omits the untrusted function label from the coordinate', async () => {
    const enriched = await enrichDetail({
      top_in_app_frame: { function: 'AliceSmith', line: 1, source: 'app.js' },
    });

    assert.equal(enriched.sample.route, 'app.js:1');
  });

  it('decodes percent-escapes before redacting frame paths', async () => {
    const enriched = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        source: 'https://cdn.example/token%3Dsecret-value.js',
      },
    });

    assert.equal(enriched.sample.route.includes('secret-value'), false);
    assert.match(enriched.sample.route, /token/);
  });

  it('strips encoded query delimiters after decoding', async () => {
    const enriched = await enrichDetail({
      top_in_app_frame: {
        function: 'load',
        source: 'app.js%3Fuser%3DAliceSmith%26account%3Dmerchant-123',
      },
    });

    assert.equal(enriched.sample.route, 'app.js');
    assert.equal(enriched.sample.route.includes('AliceSmith'), false);
    assert.equal(enriched.sample.route.includes('merchant-123'), false);
  });

  it('drops frame paths with malformed escapes', async () => {
    const enriched = await enrichDetail({
      top_in_app_frame: { function: 'load', source: 'https://x/%E0%A4%A.js' },
    });

    assert.equal(enriched.sample.route, '(redacted PostHog location)');
  });

  it('drops implausibly large frame line numbers from the coordinate', async () => {
    const phone = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 8031234567,
        source: 'route.ts',
      },
    });
    assert.equal(phone.sample.route, 'route.ts');
    assert.equal(phone.sample.route.includes('8031234567'), false);

    const large = await enrichDetail({
      top_in_app_frame: {
        function: 'handleCheckout',
        line: 250000,
        source: 'route.ts',
      },
    });
    assert.equal(large.sample.route, 'route.ts:250000');
  });
});
