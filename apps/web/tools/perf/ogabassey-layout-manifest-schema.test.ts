import { expect, it } from 'vitest';
import {
  layoutCaptureManifestSchema,
  prerenderManifestSchema,
} from './ogabassey-layout-manifest-schema';

it('accepts valid capture and prerender manifests and rejects invalid paths', () => {
  const manifest = {
    version: 1,
    assets: [{ path: 'assets/a.css', url: '/_next/static/a.css' }],
    captures: [],
  };
  expect(layoutCaptureManifestSchema.safeParse(manifest).success).toBe(true);
  expect(
    layoutCaptureManifestSchema.safeParse({
      ...manifest,
      assets: [{ path: '../secret', url: '/_next/static/a.css' }],
    }).success
  ).toBe(false);
  expect(
    layoutCaptureManifestSchema.safeParse({ ...manifest, version: 2 }).success
  ).toBe(false);
  expect(prerenderManifestSchema.safeParse({ routes: {} }).success).toBe(true);
  expect(prerenderManifestSchema.safeParse({ routes: [] }).success).toBe(false);
});
