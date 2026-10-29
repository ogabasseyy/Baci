import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
    const result = execFileSync('node', [script, directory, '2.1.663', sha, '--public-only'], { env, encoding: 'utf8' });
    assert.match(result, /private.*not.*scanned/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
