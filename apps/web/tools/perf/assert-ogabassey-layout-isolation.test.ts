import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertOgabasseyLayoutFeasibility } from './assert-ogabassey-layout-feasibility';
import {
  HERO_HINT,
  SENTINEL,
  writeFixture,
} from './assert-ogabassey-layout-feasibility.test-support';
import { layoutCaptureManifestSchema } from './ogabassey-layout-manifest-schema';

describe('critical dependency isolation', () => {
  it('rejects inline critical CSS on a generic capture', async () => {
    const fixture = await writeFixture();
    const genericPath = path.join(fixture.captureDir, 'html/generic-home.html');
    await writeFile(
      genericPath,
      `${await readFile(genericPath, 'utf8')}<style>${SENTINEL}{color:red}</style>`
    );
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/generic.*critical/i);
  });

  it('rejects a generic dependency with a compiled JSX marker', async () => {
    const fixture = await writeFixture();
    const chunk = 'const element={"data-ogabassey-critical-spike":"v1"}';
    await writeFile(
      path.join(fixture.captureDir, 'assets/oga-critical.js'),
      chunk
    );
    await writeFile(
      path.join(fixture.prebuiltDir, '_next/static/chunks/oga-critical.js'),
      chunk
    );
    const genericPath = path.join(fixture.captureDir, 'html/generic-home.html');
    await writeFile(
      genericPath,
      `${await readFile(genericPath, 'utf8')}<script src="/_next/static/chunks/oga-critical.js"></script>`
    );
    const manifestPath = path.join(fixture.captureDir, 'capture-manifest.json');
    const manifest = layoutCaptureManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8'))
    );
    const generic = manifest.captures.find(
      (capture) => capture.kind === 'generic'
    );
    if (!generic) throw new Error('fixture missing');
    generic.dependencyFiles.push('/_next/static/chunks/oga-critical.js');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/generic.*critical/i);
  });
});
