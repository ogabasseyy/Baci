import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSnapshotPaths } from './ogabassey-hero-snapshot-paths.mjs';

describe('resolveSnapshotPaths', () => {
  it('derives webRoot, manifestPath, and repo root', () => {
    const paths = resolveSnapshotPaths();
    expect(paths.webRoot.endsWith(join('apps', 'web'))).toBe(true);
    expect(paths.manifestPath).toBe(
      resolve(paths.webRoot, 'src/config/ogabassey-home-hero-snapshot-manifest.ts')
    );
    // Repo root is two levels above apps/web — never apps/ itself.
    expect(paths.root).toBe(resolve(paths.webRoot, '../..'));
    expect(paths.root).not.toBe(resolve(paths.webRoot, '..'));
  });

  it('honors an explicit webRoot (hermetic runs)', () => {
    const paths = resolveSnapshotPaths('/tmp/fake-webroot');
    expect(paths.webRoot).toBe('/tmp/fake-webroot');
    expect(paths.manifestPath).toBe(
      '/tmp/fake-webroot/src/config/ogabassey-home-hero-snapshot-manifest.ts'
    );
    expect(paths.root).toBe(resolve('/tmp/fake-webroot', '../..'));
  });
});
