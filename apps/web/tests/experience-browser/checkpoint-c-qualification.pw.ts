import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { captureExperience } from '../../tools/experience-runner/capture-route';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { checkpointBFixture } from './checkpoint-b-fixture';
import { fixtureCatalog } from './fixtures/qualification-fixtures';

const root = path.resolve(
  import.meta.dirname,
  '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-c-captures'
);
mkdirSync(root, { recursive: true });
const names = ['editorial-fashion', 'device-configurator', 'motion-studio'];
// One compile allowance per fixture. A shared 90s hook must not aggregate three
// separately bounded builds or turn a setup failure into 44 unrelated skips.
for (const name of names)
  test.describe(name, () => {
    const manifest = checkpointBFixture(name);
    let bundle: { javascript: string; css: string; digest: string };
    test.beforeAll(async () => {
      bundle = (await runLocalQualification('compile', manifest))
        .output as typeof bundle;
    });
    for (const engine of ['chromium', 'firefox', 'webkit'] as const)
      for (const width of [360, 390, 768, 1280, 1440]) {
        test(`CheckpointC semantic native-image ${engine} ${width} ${name}`, async () => {
          const result = await captureExperience({
            manifest,
            bundle,
            bootstrap: {
              catalog: fixtureCatalog,
              capabilities: manifest.capabilities,
              route: {
                epoch: 1,
                routeId: 'home',
                params: {},
                canonicalPath: '/',
                publicDataRevision: fixtureCatalog.revision,
              },
            },
            assets: [],
            assetsDigest: 'a'.repeat(64),
            engine,
            width,
          });
          expect(result.snapshot.nodes.length).toBeGreaterThan(0);
          expect(JSON.stringify(result.snapshot.nodes)).toMatch(/synthetic/i);
          expect(result.evidence.bytes.length).toBeGreaterThan(1000);
          const id = `${engine}-${width}-${name}`;
          writeFileSync(path.join(root, `${id}.png`), result.evidence.bytes);
          writeFileSync(
            path.join(root, `${id}.json`),
            JSON.stringify({
              snapshot: result.snapshot,
              evidence: {
                ...result.evidence,
                bytes: result.evidence.bytes.length,
              },
              jobId: result.jobId,
            })
          );
        });
      }
  });
