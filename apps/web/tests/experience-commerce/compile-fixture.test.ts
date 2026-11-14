// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { expect, it as qualificationTest } from 'vitest';

const it = qualificationTest.skipIf(
  process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION !== '1'
);

import { verifyCompiledCandidate } from '../../src/lib/experience/build-service';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';
import { storefrontFixture } from './storefront-fixture';

it('compiles full custom commerce source only inside the qualified offline runsc worker', async () => {
  const manifest = storefrontFixture();
  const r = await runLocalQualification(
    'compile',
    packPrivateBuild(manifest, 'http://127.0.0.1:43174')
  );
  const compiled = verifyCompiledCandidate(r.output);
  expect(compiled.hostOrigin).toBe('http://127.0.0.1:43174');
  writeFileSync(
    new URL(
      '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-compiled-fixture.json',
      import.meta.url
    ),
    JSON.stringify({ manifest, compiled })
  );
}, 90000);
