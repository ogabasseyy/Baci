import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Exercises the real package.json `exports` map of @baci/shared via
// Node resolution (createRequire), bypassing the Vitest aliases and
// Jest/tsconfig mappers that otherwise rewrite these specifiers, so a
// missing/misspelled exports entry fails here instead of in a
// production Next/Metro build.
const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(
  /\/apps\/web\/src\/lib$/,
  ''
);
const sharedPackageDir = join(repoRoot, 'packages/shared');
const appRequire = createRequire(join(repoRoot, 'apps/web/package.json'));

const subpaths = [
  '@baci/shared/vtu',
  '@baci/shared/test-fixtures/builder-ai-edit',
  '@baci/shared/test-fixtures/piggyvest-purchase',
  '@baci/shared/test-fixtures/piggyvest-device-change',
  '@baci/shared/test-fixtures/piggyvest-protected-offer',
  '@baci/shared/test-fixtures/piggyvest-draft-closure',
  '@baci/shared/test-fixtures/piggyvest-schedule',
];

describe('@baci/shared exports resolution (no test aliases)', () => {
  it('resolves every new subpath through the exports map to a real file', () => {
    for (const specifier of subpaths) {
      const resolved = appRequire.resolve(specifier);
      expect(existsSync(resolved), specifier).toBe(true);
      expect(resolved).toContain('/packages/shared/src/');
    }
  });

  it('every exports target in package.json exists on disk', () => {
    const pkg = JSON.parse(
      readFileSync(join(sharedPackageDir, 'package.json'), 'utf8')
    ) as { exports: Record<string, string> };
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(existsSync(join(sharedPackageDir, target)), subpath).toBe(true);
    }
  });
});
