import { readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertOgabasseyLayoutFeasibility } from './assert-ogabassey-layout-feasibility';
import {
  HERO_HINT,
  SENTINEL,
  writeFixture,
} from './assert-ogabassey-layout-feasibility.test-support';
import { layoutCaptureManifestSchema } from './ogabassey-layout-manifest-schema';

describe('artifact capture integrity', () => {
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
  it('accepts an empty captured noncritical dependency', async () => {
    const fixture = await writeFixture();
    await writeFile(path.join(fixture.captureDir, 'assets/shared.js'), '');
    await writeFile(
      path.join(fixture.prebuiltDir, '_next/static/chunks/shared.js'),
      ''
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
    ).resolves.toMatchObject({ passed: true });
  });

  it('rejects malformed capture entries with a clear error', async () => {
    const fixture = await writeFixture();
    const manifestPath = path.join(fixture.captureDir, 'capture-manifest.json');
    const manifest = layoutCaptureManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8'))
    );
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, assets: [...manifest.assets, null] })
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
    ).rejects.toThrow(/invalid layout feasibility capture manifest/i);
  });

  it.each([
    'missingHomeMarker',
    'missingHomeHint',
  ] as const)('rejects a served home with %s', async (key) => {
    const fixture = await writeFixture({ [key]: true });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/served home/i);
  });

  it('rejects a served home missing a static-shell dependency from the build', async () => {
    const fixture = await writeFixture({ mismatchedRawDependency: true });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/static.shell.*dependency/i);
  });

  it('rejects a served home asset missing from its dependency list', async () => {
    const fixture = await writeFixture({ extraHomeDependency: true });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/dependency.*mismatch/i);
  });

  it('rejects a home dependency omitted from the capture manifest', async () => {
    const fixture = await writeFixture();
    const manifestPath = path.join(fixture.captureDir, 'capture-manifest.json');
    const manifest = layoutCaptureManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8'))
    );
    manifest.assets = manifest.assets.filter(
      (entry) => !entry.url.endsWith('oga-critical.js')
    );
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
    ).rejects.toThrow(/missing captured dependency.*oga-critical.js/i);
  });

  it('rejects a captured dependency absent from the prebuilt output', async () => {
    const fixture = await writeFixture();
    await unlink(
      path.join(fixture.prebuiltDir, '_next/static/chunks/shared.js')
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
    ).rejects.toThrow(/prebuilt.*shared/i);
  });

  it('rejects a captured dependency from a different prebuilt artifact', async () => {
    const fixture = await writeFixture();
    await writeFile(
      path.join(fixture.prebuiltDir, '_next/static/chunks/shared.js'),
      'other build'
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
    ).rejects.toThrow(/prebuilt.*shared.*differ/i);
  });

  it.each([
    ['capture manifest', 'captureDir', 'capture-manifest.json'],
    ['prerender manifest', 'nextDir', 'prerender-manifest.json'],
    ['static shell', 'nextDir', 'server/app/ogabassey.html'],
  ] as const)('rejects symlinked %s', async (_label, rootKey, relative) => {
    const fixture = await writeFixture();
    const selected = path.join(fixture[rootKey], relative);
    const content = await readFile(selected);
    const outside = path.join(fixture.captureDir, '..', 'outside-data');
    await writeFile(outside, content);
    await unlink(selected);
    await symlink(outside, selected);
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/symlink/i);
  });

  it('rejects symlinked captured HTML', async () => {
    const fixture = await writeFixture();
    const selected = path.join(fixture.captureDir, 'html/ogabassey-home.html');
    const content = await readFile(selected);
    const outside = path.join(fixture.captureDir, '..', 'outside.html');
    await writeFile(outside, content);
    await unlink(selected);
    await symlink(outside, selected);
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/symlink/i);
  });

  it.each([
    'capture',
    'prebuilt',
  ] as const)('rejects symlinked %s assets', async (location) => {
    const fixture = await writeFixture();
    const target = path.join(fixture.captureDir, '..', 'outside.js');
    await writeFile(target, 'export const shared = true');
    const selected =
      location === 'capture'
        ? path.join(fixture.captureDir, 'assets/shared.js')
        : path.join(fixture.prebuiltDir, '_next/static/chunks/shared.js');
    await unlink(selected);
    await symlink(target, selected);
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/symlink/i);
  });

  it('rejects captured paths that escape the capture directory', async () => {
    const fixture = await writeFixture();
    const manifestPath = path.join(fixture.captureDir, 'capture-manifest.json');
    const manifest = layoutCaptureManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8'))
    );
    const first = manifest.assets[0];
    if (!first) throw new Error('Fixture has no asset');
    first.path = '../private.css';
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
    ).rejects.toThrow(/invalid layout feasibility capture manifest/i);
  });

  it('rejects OgaBassey critical dependency leakage onto the generic merchant', async () => {
    const fixture = await writeFixture({ genericLeaksCriticalFile: true });

    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/generic.*critical dependency/i);
  });
});
