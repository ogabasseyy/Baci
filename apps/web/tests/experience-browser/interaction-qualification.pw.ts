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
import { persistQualificationImage } from './persist-qualification-image';

let assets: OfflineAsset[];
const bundles = new Map<string, unknown>();
const results: unknown[] = [];
const resultFile = path.resolve(
  import.meta.dirname,
  '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/current-main-interactions.json'
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
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  assets = await materializeAssets(
    [
      { assetId: 'synthetic-image', mime: 'image/png', digest: hash(image) },
      { assetId: 'synthetic-font', mime: 'font/woff2', digest: hash(font) },
    ],
    async (id) => (id === 'synthetic-image' ? image : font)
  );
  for (const fixture of [
    'editorial-fashion',
    'device-configurator',
    'motion-studio',
  ])
    bundles.set(
      fixture,
      (await runLocalQualification('compile', wrappedFixture(fixture))).output
    );
});
for (const engine of ['chromium', 'firefox', 'webkit'] as const)
  for (const width of [390, 1440])
    for (const fixture of [
      'editorial-fashion',
      'device-configurator',
      'motion-studio',
    ])
      test(`qualification full-code interactions ${engine} ${width} ${fixture}`, async () => {
        const info = test.info();
        const result = await runLocalQualification('capture', {
          mode: 'interaction',
          fixture,
          engine,
          width,
          bundle: bundles.get(fixture),
          catalog: fixtureCatalog,
          assets,
        });
        const output = result.output as { status: string; screenshot?: string };
        expect(output.status).toBe('passed');
        expect(output.screenshot).toBeTruthy();
        const png = Buffer.from(output.screenshot ?? '', 'base64');
        const persisted = persistQualificationImage(
          path.join(path.dirname(resultFile), 'current-main-screenshots'),
          `${engine}-${width}-${fixture}.png`,
          png
        );
        const screenshot = persisted.filename;
        await info.attach('synthetic storefront', {
          path: screenshot,
          contentType: 'image/png',
        });
        delete output.screenshot;
        results.push({
          ...result,
          screenshot,
          sha256: createHash('sha256').update(png).digest('hex'),
        });
        writeFileSync(resultFile, `${JSON.stringify(results, null, 2)}\n`);
      });
