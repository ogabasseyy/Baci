import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inferAssetContentType,
  packageExportDirectory,
  parseCliArgs,
  publishOta,
  rollbackOta,
} from '../scripts/publish-ota.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createExportFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ota-cli-test-'));
  tempDirs.push(dir);
  const distDir = path.join(dir, 'dist');
  await mkdir(path.join(distDir, '_expo/static/js/ios'), { recursive: true });
  await mkdir(path.join(distDir, 'assets'), { recursive: true });

  const bundleBytes = Buffer.from('hermes-bundle-content');
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const assetMd5 = 'd41d8cd98f00b204e9800998ecf8427e';

  await writeFile(
    path.join(distDir, '_expo/static/js/ios/entry-1.hbc'),
    bundleBytes
  );
  await writeFile(path.join(distDir, 'assets', assetMd5), pngBytes);
  await writeFile(
    path.join(distDir, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        ios: {
          bundle: '_expo/static/js/ios/entry-1.hbc',
          assets: [{ path: `assets/${assetMd5}`, ext: 'png' }],
        },
      },
    })
  );
  await writeFile(
    path.join(distDir, 'assetmap.json'),
    JSON.stringify({
      [assetMd5]: {
        hash: assetMd5,
        name: 'logo',
        type: 'png',
      },
    })
  );
  const configPath = path.join(dir, 'expo-config.json');
  await writeFile(
    configPath,
    JSON.stringify({ name: 'Ogabassey', slug: 'ogabassey-store' })
  );

  return { dir, distDir, configPath, bundleBytes, pngBytes, assetMd5 };
}

describe('publish-ota CLI', () => {
  it('infers asset content types and validates CLI args', () => {
    expect(inferAssetContentType('png')).toBe('image/png');
    expect(inferAssetContentType('.woff2')).toBe('font/woff2');
    expect(inferAssetContentType('unknown')).toBe('application/octet-stream');

    expect(() =>
      parseCliArgs(['--platform', 'web', '--runtime', '1.0.0'])
    ).toThrow(/platform/);
    expect(() =>
      parseCliArgs(['--platform', 'ios', '--runtime', '1.0.0', '--dry-run'])
    ).toThrow(/--dist/);

    const rollbackArgs = parseCliArgs([
      '--platform',
      'ios',
      '--runtime',
      '2.1.663',
      '--rollback',
      '--to-embedded',
      '--dry-run',
    ]);
    expect(rollbackArgs.rollback).toBe(true);
    expect(rollbackArgs.toEmbedded).toBe(true);
  });

  it('packages expo export --dump-assetmap output with SHA-256 hashes', async () => {
    const { distDir, configPath, bundleBytes, pngBytes, assetMd5 } =
      await createExportFixture();
    const expectedBundleHash = createHash('sha256')
      .update(bundleBytes)
      .digest('base64url');
    const expectedPngHash = createHash('sha256')
      .update(pngBytes)
      .digest('base64url');

    const { payload, uploads } = await packageExportDirectory({
      distDir,
      configPath,
      platform: 'ios',
      runtimeVersion: '2.1.663-ios-sdk58-rn0880-splashmotion1',
      channel: 'production',
      sourceSha: 'b'.repeat(40),
      updateId: '11111111-1111-4111-8111-111111111111',
    });

    expect(uploads).toHaveLength(2);
    expect(payload.launchAsset.hash).toBe(expectedBundleHash);
    expect(payload.launchAsset.contentType).toBe('application/javascript');
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]?.key).toBe(assetMd5);
    expect(payload.assets[0]?.hash).toBe(expectedPngHash);
    expect(payload.assets[0]?.contentType).toBe('image/png');
    expect(payload.extra.expoClient).toEqual({
      name: 'Ogabassey',
      slug: 'ogabassey-store',
    });
  });

  it('uploads uncached assets and publishes manifest, and supports rollback', async () => {
    const { distDir, configPath } = await createExportFixture();
    const calls: { url: string; method: string }[] = [];

    const mockFetch = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method === 'HEAD' && url.includes('/blobs/')) {
        return new Response(null, { status: 200 });
      }
      if (method === 'HEAD') {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await publishOta(
      {
        distDir,
        configPath,
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        serverUrl: 'https://ota.usebaci.com',
        token: 'secret-token',
      },
      mockFetch as unknown as typeof fetch
    );

    expect(result).toEqual({ ok: true });
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    const rollbackCalls: { url: string; body: string }[] = [];
    await rollbackOta(
      {
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        toEmbedded: true,
        serverUrl: 'https://ota.usebaci.com',
        token: 'secret-token',
      },
      (async (url: string, init?: RequestInit) => {
        rollbackCalls.push({ url, body: String(init?.body ?? '') });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch
    );

    expect(rollbackCalls).toHaveLength(1);
    expect(rollbackCalls[0]?.url).toBe(
      'https://ota.usebaci.com/api/admin/rollback'
    );
    expect(JSON.parse(rollbackCalls[0]?.body ?? '')).toEqual({
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '2.1.663',
      toEmbedded: true,
    });
  });
});
