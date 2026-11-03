import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('public-only verification is explicit and never claims to scan secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-public-check-'));
  const sha = '11d3af0992600ba26e7d9a69f533ffc6737737b4';
  const script = fileURLToPath(new URL('./verify-storefront-ota-export.mjs', import.meta.url));
  try {
    await mkdir(path.join(directory, 'dist'));
    await writeFile(path.join(directory, 'dist', 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'dist', 'bundle.hbc.map'), '{}');
    await writeFile(path.join(directory, 'dist', 'metadata.json'), JSON.stringify({
      fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [] } },
    }));
    await writeFile(path.join(directory, 'expo-config.json'), JSON.stringify({
      runtimeVersion: '2.1.663',
      ios: { bundleIdentifier: 'com.ogabassey.app', buildNumber: '663' },
      updates: {
        url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
        requestHeaders: { 'expo-channel-name': 'production' },
      },
      extra: {
        eas: { projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379' },
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey', merchantDomain: 'ogabassey.com',
        apiUrl: 'https://usebaci.com', supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'public-key', posthogApiKey: 'public-key',
        facebookAppId: '123', facebookClientToken: 'client-token',
      },
    }));
    await writeFile(path.join(directory, 'provenance.json'), JSON.stringify({
      platform: 'ios', runtimeVersion: '2.1.663', sourceSha: sha,
    }));
    const env = { PATH: process.env.PATH };
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha], { env, stdio: 'pipe' }));
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha, '--public-only'], { env, stdio: 'pipe' }));
    const verified = execFileSync('node', [script, directory, '2.1.663', sha], {
      env: { ...env, SENTRY_AUTH_TOKEN: 'synthetic-sentry-secret', STOREFRONT_TIKTOK_APP_SECRET: 'synthetic-tiktok-secret' },
      encoding: 'utf8',
    });
    const digest = verified.match(/Provenance SHA-256: ([a-f0-9]{64})/)?.[1];
    assert.ok(digest, 'The workflow must emit a trusted provenance digest');
    const result = execFileSync('node', [script, directory, '2.1.663', sha, '--public-only', digest], { env, encoding: 'utf8' });
    assert.match(result, /private.*not.*scanned/i);
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha, '--public-only', '0'.repeat(64)], { env, stdio: 'pipe' }));
    await writeFile(path.join(directory, 'dist', 'bundle.hbc'), `tampered-${sha}`);
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha, '--public-only', digest], { env, stdio: 'pipe' }));
    await writeFile(path.join(directory, 'dist', 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'dist', 'bundle.hbc.map'), '{"tampered":true}');
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha, '--public-only', digest], { env, stdio: 'pipe' }));
    await writeFile(path.join(directory, 'dist', 'bundle.hbc.map'), '{}');
    const configPath = path.join(directory, 'expo-config.json');
    const changedConfig = JSON.parse(await readFile(configPath, 'utf8'));
    changedConfig.extra.unverified = true;
    await writeFile(configPath, JSON.stringify(changedConfig));
    assert.throws(() => execFileSync('node', [script, directory, '2.1.663', sha, '--public-only', digest], { env, stdio: 'pipe' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
