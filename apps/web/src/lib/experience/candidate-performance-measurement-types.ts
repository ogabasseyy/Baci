import type { ExperienceManifest } from '@baci/shared/experience';
import type { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import type { OfflineAsset } from '../../../tools/experience-runner/materialize-assets';

export type Candidate = {
  digest: string;
  javascript: string;
  css: string;
  hostOrigin: string;
  imports: string[];
};

export type LocalAsset = OfflineAsset;
export type Execute = typeof runLocalQualification;

export type CandidatePerformanceInput = {
  execute: Execute;
  manifest: ExperienceManifest;
  bootstrap(
    view: ExperienceManifest['routes'][number]['view']
  ): Promise<import('@baci/shared/experience').PublicBootstrap>;
  candidate: Candidate;
  renderer: Candidate;
  rendererKind: 'client' | 'prerender';
  assets: LocalAsset[];
  sourceDigest: string;
  hostContaminated?: () => boolean;
};
