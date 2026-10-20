import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findFixtureImportOffenders,
  findFixturePatternOffenders,
} from '../../../../.github/scripts/shared-test-fixtures-boundary';

// Import boundary: @baci/shared/test-fixtures/* is test-only surface.
// The guard logic lives in one shared implementation
// (.github/scripts/shared-test-fixtures-boundary.ts) consumed by this suite
// and both mobile guards, so the three cannot drift.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const scanRoots = [
  join(repoRoot, 'apps/web'),
  join(repoRoot, 'apps/mobile-storefront'),
  join(repoRoot, 'apps/mobile-admin'),
  join(repoRoot, 'packages/shared/src'),
  join(repoRoot, 'packages/tiktok-business'),
  join(repoRoot, 'apps/cloudflare-evidence-qualification-worker'),
];

describe('test-fixtures import boundary', () => {
  it('no non-test source imports shared test fixtures by any path', () => {
    const offenders = findFixtureImportOffenders(scanRoots).map((file) =>
      file.replace(`${repoRoot}/`, '')
    );
    expect(offenders).toEqual([]);
  }, 60_000);

  it('no developer tooling source imports shared fixtures directly', () => {
    // apps/*/tools runs in Node and is never bundled, so test-named
    // helpers are allowed there; a direct shared-fixture import is not.
    const toolsRoots = [
      join(repoRoot, 'apps/web/tools'),
      join(repoRoot, 'apps/mobile-storefront/tools'),
      join(repoRoot, 'apps/mobile-admin/tools'),
    ].filter((dir) => existsSync(dir));
    expect(findFixturePatternOffenders(toolsRoots)).toEqual([]);
  }, 60_000);

  it('flags a production -> test-utils helper -> fixture chain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
    writeFileSync(
      join(dir, 'order-test-utils.ts'),
      "import { purchaseFixture } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const f = purchaseFixture;\n"
    );
    writeFileSync(
      join(dir, 'prod.ts'),
      "import { f } from './order-test-utils';\nexport const g = f;\n"
    );
    const offenders = findFixtureImportOffenders([dir]);
    expect(offenders).toContain(join(dir, 'order-test-utils.ts'));
    expect(offenders).toContain(join(dir, 'prod.ts'));
  });

  it('flags fixture imports under nested production tools dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
    const nested = join(dir, 'src', 'feature', 'tools');
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, 'prod.ts'),
      "import { purchaseFixture } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const f = purchaseFixture;\n"
    );
    expect(findFixtureImportOffenders([dir])).toContain(
      join(nested, 'prod.ts')
    );
  });

  it('flags fixture specifiers in comments (intentional raw-text rule)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
    writeFileSync(
      join(dir, 'prod.ts'),
      "// example: import { x } from '@baci/shared/test-fixtures/piggyvest-purchase'\nexport const f = 1;\n"
    );
    expect(findFixtureImportOffenders([dir])).toContain(join(dir, 'prod.ts'));
  });

  it('flags a production file importing a plain .test module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
    writeFileSync(
      join(dir, 'prod.ts'),
      "import { x } from './foo.test';\nexport const f = x;\n"
    );
    expect(findFixtureImportOffenders([dir])).toContain(join(dir, 'prod.ts'));
  });

  it('flags nested deep-relative fixture specifiers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
    writeFileSync(
      join(dir, 'prod.ts'),
      "import { s } from '../test-fixtures/piggyvest/schedule';\nexport const g = s;\n"
    );
    expect(findFixtureImportOffenders([dir])).toContain(join(dir, 'prod.ts'));
  });
});
