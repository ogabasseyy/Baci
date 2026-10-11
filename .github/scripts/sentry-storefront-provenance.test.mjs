import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  attachReleaseProvenance,
  resolveRelease,
} from './sentry-storefront-provenance.mjs';

const sha = 'a'.repeat(40);
const env = {
  SENTRY_AUTH_TOKEN: 'private-token',
  SENTRY_ORG: 'org',
  SENTRY_PROJECT: 'store',
  GITHUB_SHA: sha,
  GITHUB_REPOSITORY: 'owner/repo',
};

test('uses native identities and resolved Expo versions, including iOS overrides', () => {
  const config = {
    version: '2.1.559',
    ios: { bundleIdentifier: 'com.store.ios', buildNumber: '559' },
    android: { package: 'com.store.android', versionCode: 818 },
  };
  assert.equal(resolveRelease(config, 'ios'), 'com.store.ios@2.1.559+559');
  assert.equal(
    resolveRelease({ ...config, version: '2.0.1' }, 'android'),
    'com.store.android@2.0.1+818'
  );
  assert.throws(() => resolveRelease(config, 'web'));
  assert.throws(() =>
    resolveRelease(
      { version: '2.0.1', android: { package: 'com.store', versionCode: 0 } },
      'android'
    )
  );
});

test('associates the exact checked-out SHA without requiring a repository integration', async () => {
  const requests = [];
  const release = 'com.store@2.0.1+818';
  const fetchFn = (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ref: sha, lastCommit: { id: sha } }),
    };
  };
  await attachReleaseProvenance({ env, release, checkoutSha: sha, fetchFn });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    ref: sha,
    url: `https://github.com/owner/repo/commit/${sha}`,
    commits: [{ id: sha }],
  });
  assert.equal(requests[2].options.method, 'GET');
});

test('fails before sending credentials for a mismatched checkout or unsafe origin', async () => {
  let calls = 0;
  const fetchFn = () => {
    calls += 1;
    throw new Error('unexpected request');
  };
  for (const args of [
    { env, checkoutSha: 'b'.repeat(40) },
    { env: { ...env, SENTRY_URL: 'http://sentry.io' }, checkoutSha: sha },
    { env: { ...env, SENTRY_AUTH_TOKEN: '' }, checkoutSha: sha },
  ]) {
    await assert.rejects(
      attachReleaseProvenance({
        ...args,
        release: 'com.store@2.0.1+818',
        fetchFn,
      })
    );
  }
  assert.equal(calls, 0);
});

test('reports safe errors and rejects missing source association', async () => {
  await assert.rejects(
    attachReleaseProvenance({
      env,
      release: 'release',
      checkoutSha: sha,
      fetchFn: async () => ({
        ok: false,
        status: 403,
        text: () => 'private-token',
      }),
    }),
    /^Error: Sentry provenance request failed with HTTP 403$/
  );
  await assert.rejects(
    attachReleaseProvenance({
      env,
      release: 'release',
      checkoutSha: sha,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ref: sha, lastCommit: null }),
      }),
    }),
    /not verified/
  );
});

test('both native workflows embed the SHA and attach provenance before compiling', () => {
  for (const platform of ['android', 'ios']) {
    const workflow = readFileSync(
      new URL(
        `../workflows/${platform}-storefront-release.yml`,
        import.meta.url
      ),
      'utf8'
    );
    assert.match(workflow, /EXPO_PUBLIC_BUILD_SHA: \$\{\{ github.sha \}\}/);
    assert.ok(
      workflow.indexOf(`sentry-storefront-provenance.mjs ${platform}`) > 0
    );
    assert.ok(
      workflow.indexOf(`sentry-storefront-provenance.mjs ${platform}`) <
        workflow.indexOf(
          platform === 'android'
            ? 'Build Android App Bundle'
            : 'bundle exec fastlane ios release'
        )
    );
  }
});

test('creates a new version without claiming it was deployed', async () => {
  const requests = [];
  const fetchFn = (_url, options) => {
    requests.push(options);
    if (requests.length === 1) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ref: sha, lastCommit: { id: sha } }),
    };
  };
  await attachReleaseProvenance({
    env,
    release: 'com.store@2.0.1+819',
    checkoutSha: sha,
    fetchFn,
  });
  const body = JSON.parse(requests[1].body);
  assert.equal(requests[1].method, 'POST');
  assert.equal(body.version, 'com.store@2.0.1+819');
  assert.deepEqual(body.projects, ['store']);
  assert.equal(body.dateReleased, null);
});

test('does not rewrite a shipped version or another revision', async () => {
  for (const existing of [
    { ref: 'b'.repeat(40) },
    { ref: null, firstEvent: '2026-10-01T00:00:00Z' },
  ]) {
    let requests = 0;
    await assert.rejects(
      attachReleaseProvenance({
        env,
        release: 'release',
        checkoutSha: sha,
        fetchFn: () => {
          requests += 1;
          return { ok: true, status: 200, json: async () => existing };
        },
      }),
      /conflicts/
    );
    assert.equal(requests, 1);
  }
});

test('the CI quality gate runs the provenance regressions', () => {
  const workflow = readFileSync(
    new URL('../workflows/ci.yml', import.meta.url),
    'utf8'
  );
  assert.match(
    workflow,
    /run: node --test \.github\/scripts\/sentry-storefront-provenance\.test\.mjs/
  );
});
