import type { ExperienceManifest } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import { packPrivateBuild, unpackPrivateBuild } from './private-build-payload';

it('carries the exact4MiB raw source budget without raising the8MiB transport cap', () => {
  const manifest = {
    files: Array.from({ length: 8 }, (_, i) => ({
      path: `file${i}.tsx`,
      content: '\n'.repeat(524288),
    })),
  } as ExperienceManifest;
  const wire = packPrivateBuild(manifest, 'http://127.0.0.1:4100');
  expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(8388608);
  expect(unpackPrivateBuild(wire)?.manifest).toEqual(manifest);
});
it('rejects invalid compressed envelopes and passes ordinary qualification manifests unchanged', () => {
  expect(unpackPrivateBuild({ format: 'baci.experience/v2' })).toBeNull();
  expect(() =>
    unpackPrivateBuild({
      mode: 'private-build-gzip',
      hostOrigin: 'http://127.0.0.1:4100',
      manifestGzip: 'not base64',
    })
  ).toThrow();
});
it('requires an explicit production envelope for canonical HTTPS compilation', () => {
  const manifest = { files: [] } as unknown as ExperienceManifest;
  expect(() =>
    packPrivateBuild(manifest, 'https://shop.merchant.test')
  ).toThrow();
  const wire = packPrivateBuild(
    manifest,
    'https://shop.merchant.test',
    'production'
  );
  expect(unpackPrivateBuild(wire)).toEqual({
    mode: 'private-build',
    manifest,
    hostOrigin: 'https://shop.merchant.test',
    profile: 'production',
  });
  expect(() => unpackPrivateBuild({ ...wire, profile: 'arbitrary' })).toThrow();
  expect(() =>
    packPrivateBuild(manifest, 'http://127.0.0.1:4100', 'production')
  ).toThrow();
});
