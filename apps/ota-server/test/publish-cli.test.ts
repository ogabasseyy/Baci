import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inferAssetContentType,
  type OtaFetch,
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
  await writeFile(path.join(distDir, 'assets', `${assetMd5}.png`), pngBytes);
  await writeFile(
    path.join(distDir, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        ios: {
          bundle: '_expo/static/js/ios/entry-1.hbc',
          assets: [{ path: `assets/${assetMd5}.png`, ext: 'png' }],
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

function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('publish-ota CLI', () => {
  it('infers asset content types and validates CLI args strictly', () => {
    expect(inferAssetContentType('png')).toBe('image/png');
    expect(inferAssetContentType('.woff2')).toBe('font/woff2');
    expect(inferAssetContentType('unknown')).toBe('application/octet-stream');

    expect(() =>
      parseCliArgs(['--platform', 'web', '--runtime', '1.0.0'])
    ).toThrow(/platform/);
    expect(() =>
      parseCliArgs(['--platform', 'ios', '--runtime', '1.0.0', '--dry-run'])
    ).toThrow(/--dist/);
    expect(() =>
      parseCliArgs([
        '--platform',
        'ios',
        '--runtime',
        '1.0.0',
        '--rollback',
        '--dry-run',
        '--update-id',
      ])
    ).toThrow(/Missing or invalid value/);
    expect(() =>
      parseCliArgs([
        '--platform',
        'ios',
        '--runtime',
        '1.0.0',
        '--dist',
        '/tmp/dist',
        '--to-embedded',
        '--dry-run',
      ])
    ).toThrow(/--to-embedded requires --rollback/);
    expect(() =>
      parseCliArgs([
        '--platform',
        'ios',
        '--runtime',
        '1.0.0',
        '--channel',
        '../prod',
        '--rollback',
        '--dry-run',
      ])
    ).toThrow(/--channel/);

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

  it('rejects symlinked parent directories escaping canonical export root', async () => {
    const { dir, distDir } = await createExportFixture();
    const outsideDir = path.join(dir, 'outside');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, 'secret.hbc'), 'secret-bytes');
    await symlink(outsideDir, path.join(distDir, 'linked-dir'));
    await writeFile(
      path.join(distDir, 'metadata.json'),
      JSON.stringify({
        version: 0,
        bundler: 'metro',
        fileMetadata: {
          ios: {
            bundle: 'linked-dir/secret.hbc',
            assets: [],
          },
        },
      })
    );

    await expect(
      packageExportDirectory({
        distDir,
        platform: 'ios',
        runtimeVersion: '2.1.663',
      })
    ).rejects.toThrow(/escapes/);
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

  it('rejects non-HTTPS endpoints before any fetch call while allowing dry-run offline', async () => {
    const { distDir, configPath } = await createExportFixture();
    let fetchCount = 0;
    const spyFetch: OtaFetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };

    await expect(
      publishOta(
        {
          distDir,
          configPath,
          platform: 'ios',
          runtimeVersion: '2.1.663',
          serverUrl: 'http://ota.usebaci.com',
          token: 'secret-token',
        },
        spyFetch
      )
    ).rejects.toThrow(/https:\/\//);

    await expect(
      rollbackOta(
        {
          platform: 'ios',
          runtimeVersion: '2.1.663',
          serverUrl: 'http://ota.usebaci.com',
          token: 'secret-token',
        },
        spyFetch
      )
    ).rejects.toThrow(/https:\/\//);

    expect(fetchCount).toBe(0);

    const dryRunResult = await publishOta(
      {
        distDir,
        configPath,
        platform: 'ios',
        runtimeVersion: '2.1.663',
        serverUrl: 'http://localhost:8787',
        token: '',
        dryRun: true,
      },
      spyFetch
    );
    expect(dryRunResult.dryRun).toBe(true);
    expect(fetchCount).toBe(0);
  });

  it('uploads uncached/mismatched assets with redirect error, normalizes serverUrl, and supports rollback', async () => {
    const { distDir, configPath, pngBytes } = await createExportFixture();
    const pngShaHex = createHash('sha256').update(pngBytes).digest('hex');
    const calls: { url: string; method: string; redirect?: string }[] = [];

    const mockFetch: OtaFetch = async (input, init) => {
      const url = getRequestUrl(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, redirect: init?.redirect });
      if (method === 'HEAD' && url.includes('/blobs/')) {
        return new Response(null, {
          status: 200,
          headers: { 'x-asset-sha256': pngShaHex },
        });
      }
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'x-asset-sha256': '0'.repeat(64) },
        });
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
        serverUrl: 'https://ota.usebaci.com/api/manifest/',
        token: 'secret-token',
      },
      mockFetch
    );

    expect(result).toEqual({ ok: true });
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.every((c) => c.redirect === 'error')).toBe(true);
    expect(calls.find((c) => c.method === 'POST')?.url).toBe(
      'https://ota.usebaci.com/api/admin/publish'
    );

    const rollbackCalls: {
      url: string;
      body: string;
      redirect?: string;
      idempotencyKey?: string;
    }[] = [];
    const rollbackFetch: OtaFetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      rollbackCalls.push({
        url: getRequestUrl(input),
        body: String(init?.body ?? ''),
        redirect: init?.redirect,
        idempotencyKey: headers.get('idempotency-key') ?? undefined,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await rollbackOta(
      {
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        toEmbedded: true,
        serverUrl: 'https://ota.usebaci.com/',
        token: 'secret-token',
      },
      rollbackFetch
    );

    expect(rollbackCalls).toHaveLength(1);
    expect(rollbackCalls[0]?.url).toBe(
      'https://ota.usebaci.com/api/admin/rollback'
    );
    expect(rollbackCalls[0]?.redirect).toBe('error');
    expect(rollbackCalls[0]?.idempotencyKey).toBeTruthy();
    expect(JSON.parse(rollbackCalls[0]?.body ?? '')).toEqual({
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '2.1.663',
      toEmbedded: true,
    });
  });
});
