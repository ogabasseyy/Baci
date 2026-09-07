/** @vitest-environment node */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const nextPackageJsonPath = require.resolve('next/package.json');
const nextRoot = dirname(nextPackageJsonPath);

const patchedNextFiles = [
  'dist/server/app-render/app-render.js',
  'dist/esm/server/app-render/app-render.js',
  'dist/compiled/next-server/app-page.runtime.dev.js',
  'dist/compiled/next-server/app-page.runtime.prod.js',
  'dist/compiled/next-server/app-page-experimental.runtime.dev.js',
  'dist/compiled/next-server/app-page-experimental.runtime.prod.js',
  'dist/compiled/next-server/app-page-turbo.runtime.dev.js',
  'dist/compiled/next-server/app-page-turbo.runtime.prod.js',
  'dist/compiled/next-server/app-page-turbo-experimental.runtime.dev.js',
  'dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js',
] as const;

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

const serveStreamingMetadataPattern =
  /!![\w$.]+\.renderOpts\.serveStreamingMetadata/g;
const developmentPatchedPattern =
  /typeof\s+[\w$.]+\.renderOpts\.postponed\s*===\s*['"]string['"]\s*\|\|\s*!![\w$.]+\.renderOpts\.serveStreamingMetadata/g;
const productionPatchedPattern =
  /['"]string['"]\s*==={0,1}\s*typeof\s+[\w$.]+\.renderOpts\.postponed\s*\|\|\s*!![\w$.]+\.renderOpts\.serveStreamingMetadata/g;

describe('Next PPR bot metadata resume patch integrity', () => {
  it('pins the patched Next version until the upstream fix is released', () => {
    const nextPackage = JSON.parse(
      readFileSync(nextPackageJsonPath, 'utf8')
    ) as {
      version?: string;
    };

    // Backport of vercel/next.js#94630 for digest 1617769459.
    // Remove this assertion together with the Next.js patch after
    // upgrading to a stable Next release that contains the upstream fix.
    expect(nextPackage.version).toBe('16.3.4');
  });

  it.each(
    patchedNextFiles
  )('keeps the PPR resume metadata fix applied in next/%s', (relativePath) => {
    const absolutePath = join(nextRoot, relativePath);
    expect(existsSync(absolutePath)).toBe(true);

    const source = readFileSync(absolutePath, 'utf8');
    const patchedExpressionCount =
      countMatches(source, developmentPatchedPattern) +
      countMatches(source, productionPatchedPattern);
    const serveStreamingMetadataCount = countMatches(
      source,
      serveStreamingMetadataPattern
    );

    // The upstream change should apply at exactly three metadata-rendering
    // branch sites in each checked Next runtime artifact. Update both counts
    // when patchedExpressionCount or serveStreamingMetadataCount changes in a
    // future upstream Next release.
    expect(patchedExpressionCount).toBe(3);
    expect(serveStreamingMetadataCount).toBe(3);
  });
});
