import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import type { OfflineAsset } from '../../../tools/experience-runner/materialize-assets';
import type { CompiledCandidate } from './compiled-candidate';
import { verifyIndependentBuilds } from './finalize-build';
import { digestBytes } from './manifest-digest';

/** Render proof only. Owner authorization, attempt checks and durable acceptance
 * remain in the trusted build supervisor before and after this bounded matrix. */
export async function qualifyBuildRender(input: {
  execute: typeof runLocalQualification;
  candidate: CompiledCandidate;
  independentOutput: unknown;
  readCandidate(): unknown;
  manifest: ExperienceManifest;
  bootstrap: PublicBootstrap;
  hostOrigins: string[];
  assets: OfflineAsset[];
}) {
  if (input.hostOrigins.length < 1 || input.hostOrigins.length > 2)
    throw Error('BUILD_FAILED');
  const proofs = [];
  for (const hostOrigin of input.hostOrigins)
    for (const engine of ['chromium', 'firefox', 'webkit'])
      for (const width of [390, 1440]) {
        const proof = await input.execute('capture', {
          mode: 'checkpoint-b',
          verificationOnly: true,
          engine,
          width,
          bundle: input.candidate,
          manifest: input.manifest,
          bootstrap: input.bootstrap,
          hostOrigin,
          assets: input.assets,
        });
        const render = proof.output as {
          status?: string;
          buildDigest?: string;
          screenshot?: string;
        };
        verifyIndependentBuilds(
          input.readCandidate(),
          input.independentOutput,
          render
        );
        if (render.buildDigest !== input.candidate.digest || !render.screenshot)
          throw Error('BUILD_FAILED');
        const bytes = Buffer.from(render.screenshot, 'base64');
        if (
          bytes.length > 2097152 ||
          bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        )
          throw Error('BUILD_FAILED');
        proofs.push({
          jobId: proof.jobId,
          engine,
          width,
          screenshotDigest: digestBytes(bytes),
          hostOrigin,
        });
      }
  return proofs;
}
