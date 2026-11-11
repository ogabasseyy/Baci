import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import type { LocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import type { TransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import type { OwnerRequestContext } from './authorization';
import type { BuildPerformanceDependencies } from './build-performance-types';

export interface VerifierReceipt {
  merchantId: string;
  jobId: string;
  attemptNonce: string;
  buildDigest: string;
  receiptDigest: string;
  hostOrigin: string;
}

export type ExperienceBuildDependencies = {
  profile?: 'production';
  previewOrigin?: string;
  prerenderArtifacts?: LocalPrerenderArtifacts;
  key: Uint8Array;
  toolchainDigest: string;
  hostOrigin: string;
  transient: TransientOutputStore;
  recordVerifiedEvidence: (receipt: VerifierReceipt) => Promise<void>;
  bootstrap:
    | PublicBootstrap
    | ((
        ctx: OwnerRequestContext,
        manifest: ExperienceManifest
      ) => Promise<PublicBootstrap>);
  execute?: typeof runLocalQualification;
} & BuildPerformanceDependencies;
