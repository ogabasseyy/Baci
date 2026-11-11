import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { checkpointBFixture } from './checkpoint-b-fixture';
import { fixtureCatalog } from './fixtures/qualification-fixtures';
import { persistQualificationImage } from './persist-qualification-image';

const records: unknown[] = [];
for (const name of [
  'editorial-fashion',
  'device-configurator',
  'motion-studio',
])
  test.describe(name, () => {
    const manifest = checkpointBFixture(name);
    let compiled: Awaited<ReturnType<typeof runLocalQualification>>;
    test.beforeAll(async () => {
      compiled = await runLocalQualification('compile', manifest);
    });
    for (const engine of ['chromium', 'firefox', 'webkit'] as const)
      for (const width of [390, 1440]) {
        test(`CheckpointB preview-launch route-epoch navigation-open ${engine} ${width} ${name}`, async () => {
          const result = await runLocalQualification('capture', {
            mode: 'checkpoint-b',
            engine,
            width,
            manifest,
            bundle: compiled.output,
            bootstrap: {
              catalog: fixtureCatalog,
              route: {
                epoch: 1,
                routeId: 'home',
                params: {},
                canonicalPath: '/',
                publicDataRevision: 'synthetic-1',
              },
              capabilities: manifest.capabilities,
            },
          });
          const out = result.output as { status: string; screenshot: string };
          expect(out.status).toBe('passed');
          const png = Buffer.from(out.screenshot, 'base64');
          const root = path.resolve(
            import.meta.dirname,
            '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b'
          );
          const image = persistQualificationImage(
            root,
            `${engine}-${width}-${name}.png`,
            png
          );
          await test.info().attach('Private full-code preview', {
            path: image.filename,
            contentType: 'image/png',
          });
          delete (out as { screenshot?: string }).screenshot;
          records.push({
            ...result,
            image: path.basename(image.filename),
            imageDigest: createHash('sha256').update(png).digest('hex'),
          });
          writeFileSync(
            path.join(root, 'browser-results.json'),
            JSON.stringify(records, null, 2)
          );
        });
      }
  });
test('CheckpointB exact4MiB source quota stays within the8MiB isolated transport', async () => {
  const component =
    'export default function App(){return <h1>Total source quota</h1>}';
  const manifest = checkpointBFixture('device-configurator');
  manifest.entry = 'file0.tsx';
  manifest.packages = [];
  manifest.files = Array.from({ length: 8 }, (_, i) => ({
    path: `file${i}.tsx`,
    content:
      i === 0
        ? '\n'.repeat(524288 - Buffer.byteLength(component)) + component
        : '\n'.repeat(524288),
  }));
  const { packPrivateBuild } = await import(
    '../../tools/experience-runner/private-build-payload'
  );
  const wire = packPrivateBuild(manifest, 'http://127.0.0.1:4100');
  expect(wire.mode).toBe('private-build-gzip');
  const result = await runLocalQualification('compile', wire);
  expect((result.output as { javascript: string }).javascript).toContain(
    'Total source quota'
  );
});
