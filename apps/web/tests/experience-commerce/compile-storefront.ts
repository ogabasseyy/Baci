import { verifyCompiledCandidate } from '@/lib/experience/compiled-candidate';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor.ts';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload.ts';
import { storefrontFixture } from './storefront-fixture.ts';

/** Local synthetic source is freshly compiled inside the offline gVisor worker. */
export async function compileStorefrontFixture() {
  const manifest = storefrontFixture();
  const result = await runLocalQualification(
    'compile',
    packPrivateBuild(manifest, 'http://127.0.0.1:43174')
  );
  const compiled = verifyCompiledCandidate(result.output);
  if (compiled.hostOrigin !== 'http://127.0.0.1:43174')
    throw Error('COMPILED_FIXTURE_MISMATCH');
  return { manifest, compiled };
}
