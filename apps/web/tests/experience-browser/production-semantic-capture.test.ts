import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ExperienceManifest } from '@baci/shared/experience';
import { expect, it as qualificationTest } from 'vitest';

// Explicit opt-in: requires the separately provisioned local Colima/gVisor fixture.
const it = qualificationTest.skipIf(
  process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION !== '1'
);

import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import {
  semanticElements,
  semanticText,
} from '../../src/lib/experience/semantic-data';
import { captureExperience } from '../../tools/experience-runner/capture-route';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';
import {
  createRunnerExecutor,
  createRunnerHandler,
} from '../../tools/experience-runner/runner-transport';

it('captures semantic evidence from a real offline HTTPS execution frame through the signed runner', async () => {
  const key = randomBytes(32);
  const toolchainDigest = JSON.parse(
    readFileSync(
      new URL(
        '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json',
        import.meta.url
      ),
      'utf8'
    )
  ).digest as string;
  const handler = createRunnerHandler({
    key,
    toolchainDigest,
    execute: runLocalQualification,
  });
  const execute = createRunnerExecutor({
    endpoint: 'https://runner.synthetic.test/v1/execute',
    key,
    toolchainDigest,
    fetch: (url, init) => handler(new Request(url, init)),
  });
  const hostOrigin = 'https://shop.synthetic.test';
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [
      {
        path: 'app.tsx',
        content:
          'export default function Store(){return <main><h1>Synthetic production semantic preview</h1><button>Custom control</button></main>}',
      },
    ],
    packages: [],
    assets: [],
    routes: [{ path: '/', view: 'home' }],
    capabilities: ['navigation', 'catalog.read'],
  };
  const bundle = verifyCompiledCandidate(
    (
      await execute(
        'compile',
        packPrivateBuild(manifest, hostOrigin, 'production')
      )
    ).output
  );
  const proof = await captureExperience(
    {
      manifest,
      hostOrigin,
      bundle,
      assets: [],
      assetsDigest: digestBytes('[]'),
      engine: 'chromium',
      width: 390,
      bootstrap: {
        route: {
          epoch: 1,
          routeId: 'home',
          canonicalPath: '/',
          params: {},
          publicDataRevision: 'synthetic',
        },
        catalog: { revision: 'synthetic', products: [] },
        capabilities: manifest.capabilities,
      },
    },
    execute
  );
  expect(
    semanticElements(proof.snapshot.nodes).some((node) => node.tag === 'h1')
  ).toBe(true);
  expect(semanticText(proof.snapshot.nodes)).toContain(
    'Synthetic production semantic preview'
  );
}, 90000);
