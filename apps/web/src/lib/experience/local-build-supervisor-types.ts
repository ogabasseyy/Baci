import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import type { LocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import type { TransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import type { ExperienceContext, OwnerRequestContext } from './authorization';
import type { BuildPerformanceDependencies } from './build-performance-types';

export interface VerifierReceipt {
  merchantId: string;
  jobId: string;
  attemptNonce: string;
  buildDigest: string;
  receiptDigest: string;
  hostOrigin: string;
}

export type ExperienceBuildExecutor = typeof runLocalQualification & {
  withSignal?(
    kind: Parameters<typeof runLocalQualification>[0],
    payload: unknown,
    signal: AbortSignal
  ): ReturnType<typeof runLocalQualification>;
};

export type ExperienceBuildDependencies = {
  profile?: 'production';
  previewOrigin?: string;
  prerenderArtifacts?: LocalPrerenderArtifacts;
  verifiedRendererStorage?: boolean;
  key: Uint8Array;
  toolchainDigest: string;
  hostOrigin: string;
  transient: TransientOutputStore;
  recordVerifiedEvidence: (
    receipt: VerifierReceipt,
    context: ExperienceContext
  ) => Promise<void>;
  bootstrap:
    | PublicBootstrap
    | ((
        ctx: OwnerRequestContext,
        manifest: ExperienceManifest
      ) => Promise<PublicBootstrap>);
  execute?: ExperienceBuildExecutor;
} & BuildPerformanceDependencies;
