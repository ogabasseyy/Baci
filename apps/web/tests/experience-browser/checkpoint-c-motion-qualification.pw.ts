import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { captureExperience } from '../../tools/experience-runner/capture-route';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { checkpointBFixture } from './checkpoint-b-fixture';
import { fixtureCatalog } from './fixtures/qualification-fixtures';

const manifest = checkpointBFixture('motion-studio');
let bundle: { javascript: string; css: string; digest: string };
const directory = path.resolve(
  import.meta.dirname,
  '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-c-motion'
);
test.beforeAll(async () => {
  bundle = (await runLocalQualification('compile', manifest))
    .output as typeof bundle;
  mkdirSync(directory, { recursive: true });
});

for (const engine of ['chromium', 'firefox', 'webkit'] as const)
  test(`CheckpointC reduced-motion semantic parity ${engine}`, async () => {
    const captures = [];
    for (const reducedMotion of [false, true]) {
      const result = await captureExperience({
        manifest,
        bundle,
        engine,
        width: 390,
        reducedMotion,
        assets: [],
        assetsDigest: 'a'.repeat(64),
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
      });
      const id = `${engine}-${result.snapshot.key.state}`;
      writeFileSync(path.join(directory, `${id}.png`), result.evidence.bytes);
      writeFileSync(
        path.join(directory, `${id}.json`),
        JSON.stringify({ snapshot: result.snapshot, jobId: result.jobId })
      );
      captures.push(result);
    }
    expect(captures[0].snapshot.nodes.length).toBeGreaterThan(0);
    expect(captures[1].snapshot.nodes).toEqual(captures[0].snapshot.nodes);
    expect(captures[0].snapshot.key.state).toBe('default');
    expect(captures[1].snapshot.key.state).toBe('reduced-motion');
    expect(captures[1].evidence.bytes.length).toBeGreaterThan(1000);
  });
