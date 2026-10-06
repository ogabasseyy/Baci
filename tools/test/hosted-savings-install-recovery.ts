import { z } from 'zod';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const systemIdentifier = z.string().regex(/^[1-9][0-9]{0,19}$/);
const lineage = z.object({
  parentReviewed: z.literal(true),
  priorContainerId: digest,
  currentContainerId: digest,
  priorImageId: image,
  currentImageId: image,
  priorSystemIdentifier: systemIdentifier,
  currentSystemIdentifier: systemIdentifier,
  priorVolumeIdentitySha256: digest,
  currentVolumeIdentitySha256: digest,
  priorIdentityEvidenceSha256: digest,
  currentIdentityEvidenceSha256: digest,
}).strict();
const metadata = z.object({
  containerId: digest,
  manifestSha256: digest,
  journalRows: z.literal(0),
  ledgerRows: z.literal(0),
  applicationRows: z.literal(0),
  maintenance: z.literal(true),
  parentVerified: z.literal(true),
  backupSha256: digest,
  backupVerified: z.literal(true),
  retainOriginalVolumeAndManagedState: z.literal(true),
  lineage: lineage.optional(),
}).strict();
const failure = z.object({
  status: z.literal('failed'),
  phase: z.literal('migration'),
  attemptedOrdinal: z.literal(1),
  completed: z.literal(0),
  claimed: z.literal(true),
  resumeAllowed: z.literal(false),
  containerId: digest,
  imageId: image,
  manifestSha256: digest,
}).passthrough();

export function planHostedSavingsInstallRecovery(receiptValue: unknown, failureValue: unknown, metadataValue: unknown) {
  const receipt = hostedSavingsInstallContract.parse(receiptValue);
  const failed = failure.parse(failureValue);
  const proof = metadata.parse(metadataValue);
  if (proof.containerId !== receipt.containerId || failed.manifestSha256 !== receipt.manifestSha256 ||
      proof.manifestSha256 !== receipt.manifestSha256) throw new Error('Recovery evidence identity mismatch');
  const changed = failed.containerId !== receipt.containerId || failed.imageId !== receipt.imageId;
  if (changed && !proof.lineage) throw new Error('Changed container requires explicit reviewed cluster and volume lineage');
  if (proof.lineage) {
    const reviewed = proof.lineage;
    if (reviewed.priorContainerId !== failed.containerId || reviewed.currentContainerId !== receipt.containerId ||
      reviewed.priorImageId !== failed.imageId || reviewed.currentImageId !== receipt.imageId ||
      reviewed.priorSystemIdentifier !== reviewed.currentSystemIdentifier ||
      reviewed.priorVolumeIdentitySha256 !== reviewed.currentVolumeIdentitySha256)
      throw new Error('Reviewed cluster or volume lineage mismatch');
  }
  return {
    mode: 'separate-disposable-rebuild-required',
    executionAuthorized: false,
    inPlaceResetAuthorized: false,
    resumeAllowed: false,
    originalContainerId: failed.containerId,
    currentContainerId: receipt.containerId,
    identityLineage: changed ? 'parent-attested-same-cluster-and-volume' : 'unchanged-container-and-image',
    manifestSha256: receipt.manifestSha256,
    backupSha256: proof.backupSha256,
    evidenceAuthority: 'parent-supplied metadata; no live database verification',
    reason: 'No preinstall public ACL/owner or complete nonpublic catalog snapshot exists in the failed receipt; transactional CASCADE preservation cannot be proven.',
    steps: [
      'Retain the original failed volume and its current locked container untouched, including Auth/Storage data and roles; an already removed prior container is not required.',
      'Parent verifies a private backup of this owned isolated database and globals; never log backup contents or copy production material.',
      'Provision a distinct isolated container and volume through the reviewed official prerequisite procedure; never reuse the failed volume.',
      'Keep existing Auth/Storage on the original instance. If transferring those records is required, stop for a separate reviewed managed-data transfer plan.',
      'Install genuine extensions.pg_stat_statements with required columns; retain background and event-trigger containment.',
      'Require new immutable identity receipt, parent review and successful full preflight before fresh ordinal-1 replay.',
    ],
  };
}
