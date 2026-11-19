import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import {
  materializeAssets,
  type OfflineAsset,
} from '../../tools/experience-runner/materialize-assets';
import { fixtureCatalog } from './fixtures/qualification-fixtures';
import { wrappedFixture } from './harness-fixture';

const results: unknown[] = [];
let assets: OfflineAsset[];
const bundles = new Map<string, unknown>();
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const resultFile = path.resolve(
  import.meta.dirname,
  '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/remaining-checks.json'
);
test.beforeAll(async () => {
  const image = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#4466aa' },
  })
    .png()
    .toBuffer();
  const font = readFileSync(
    new URL(
      '../../public/fonts/inter-naira.61440e0f45d4.woff2',
      import.meta.url
    )
  );
  assets = await materializeAssets(
    [
      { assetId: 'synthetic-image', mime: 'image/png', digest: digest(image) },
      { assetId: 'synthetic-font', mime: 'font/woff2', digest: digest(font) },
    ],
    async (id) => (id === 'synthetic-image' ? image : font)
  );
  for (const fixture of [
    'editorial-fashion',
    'device-configurator',
    'motion-studio',
  ]) {
    const { output } = await runLocalQualification(
      'compile',
      wrappedFixture(fixture)
    );
    bundles.set(fixture, output);
  }
});
function record(value: unknown) {
  results.push(value);
  writeFileSync(resultFile, `${JSON.stringify(results, null, 2)}\n`);
}
for (const engine of ['chromium', 'firefox', 'webkit'] as const)
  for (const width of [390, 1440]) {
    for (const fixture of [
      'editorial-fashion',
      'device-configurator',
      'motion-studio',
    ])
      test(`qualification native SEO assets ${engine} ${width} ${fixture}`, async () => {
        const result = await runLocalQualification('checks', {
          mode: 'native-seo-assets',
          engine,
          width,
          bundle: bundles.get(fixture),
          catalog: fixtureCatalog,
          assets,
        });
        expect(result.output).toMatchObject({
          status: 'passed',
          checks: {
            crawlableRouteParity: 4,
            trustedNativeGestures: 4,
            offlineImageFontDecoded: true,
          },
        });
        record({ fixture, ...result });
      });
    test(`qualification adversarial frame ${engine} ${width}`, async () => {
      const result = await runLocalQualification('checks', {
        mode: 'attack',
        engine,
        width,
        bundle: bundles.get('device-configurator'),
        catalog: fixtureCatalog,
        assets,
      });
      expect(result.output).toMatchObject({
        status: 'passed',
        checks: {
          frameEscapesDenied: true,
          credentialAndHostFilesAbsent: true,
        },
      });
      record(result);
    });
  }
for (const engine of ['chromium', 'firefox', 'webkit'] as const)
  test(`qualification kills infinite React render ${engine}`, async () => {
    const source = wrappedFixture('device-configurator');
    source.files[0].content =
      'export default function Infinite(){while(true){} }';
    const { output: bundle } = await runLocalQualification('compile', source);
    const start = performance.now();
    let failure: unknown;
    try {
      await runLocalQualification('checks', {
        mode: 'infinite-render',
        engine,
        width: 390,
        bundle,
        catalog: fixtureCatalog,
        assets,
      });
    } catch (error) {
      failure = error;
    }
    const error = failure as { stderr?: string; signal?: string };
    expect(error?.stderr).toContain('INFINITE_RENDER_STARTED');
    expect(performance.now() - start).toBeGreaterThanOrEqual(29000);
    record({
      engine,
      check: 'infinite-render',
      blocked: true,
      wallMs: Math.round(performance.now() - start),
    });
  });
test('qualification rejects output flood, missing media, corrupt font and wrong asset hash', async () => {
  const base = {
    engine: 'chromium',
    width: 390,
    bundle: bundles.get('device-configurator'),
    catalog: fixtureCatalog,
    assets,
  };
  for (const mode of ['output-flood', 'mixed-output-flood']) {
    let failure: unknown;
    try {
      await runLocalQualification('checks', { ...base, mode });
    } catch (error) {
      failure = error;
    }
    expect((failure as { code?: string })?.code).toBe(
      'EXPERIENCE_OUTPUT_BUDGET'
    );
    record({ check: mode, blocked: true });
  }
  for (const mode of ['missing', 'corrupt', 'hash']) {
    const changed = structuredClone(assets);
    if (mode === 'missing') changed.pop();
    if (mode === 'hash') changed[0].digest = '0'.repeat(64);
    if (mode === 'corrupt') {
      const bytes = Buffer.from(changed[1].bytesBase64, 'base64');
      bytes.fill(0, 48);
      changed[1].bytesBase64 = bytes.toString('base64');
      changed[1].digest = digest(bytes);
    }
    let caught: unknown;
    try {
      await runLocalQualification('checks', {
        ...base,
        mode: 'native-seo-assets',
        assets: changed,
      });
    } catch (error) {
      caught = error;
    }
    const stderr = (caught as { stderr?: string })?.stderr ?? '';
    expect(stderr).toMatch(
      mode === 'missing'
        ? /Missing offline image\/font/
        : mode === 'hash'
          ? /digest mismatch/
          : /font|Font/
    );
    record({ check: `${mode}-asset`, blocked: true });
  }
  const forged = wrappedFixture('device-configurator');
  forged.files[0].content =
    'import {useEffect} from "react"; export default function Forged(){useEffect(()=>{parent.postMessage({ready:true,accepted:true,status:"passed"},"*")},[]);return null}';
  const compiled = await runLocalQualification('compile', forged);
  let fakeReady: unknown;
  try {
    await runLocalQualification('checks', {
      ...base,
      mode: 'attack',
      bundle: compiled.output,
    });
  } catch (error) {
    fakeReady = error;
  }
  expect((fakeReady as { stderr?: string })?.stderr).toMatch(/Timeout|heading/);
  record({ check: 'forged-readiness', blocked: true });
});
