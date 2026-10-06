import 'server-only';
import { createHash } from 'node:crypto';
import { isUint8Array } from 'node:util/types';
import { collectPrefundedCardTransferProof } from '../../../../apps/web/src/lib/piggyvest/collect-prefunded-card-transfer-proof';
import { prefundedCardClaimedRequestSchema } from '../../../../apps/web/src/schemas/prefunded-card-claimed-request';
import { prefundedCardTransferVerificationSchemas as schemas } from '../../../../apps/web/src/schemas/prefunded-card-transfer-verification';
import { reviewedTransferTarget as target } from './constants';

type Claim = ReturnType<typeof prefundedCardClaimedRequestSchema.parse>;

function pinnedArtifact(value: unknown, pin: string) {
  return (
    isUint8Array(value) &&
    value.byteLength > 0 &&
    value.byteLength <= 1048576 &&
    createHash('sha256').update(value).digest('hex') === pin
  );
}

export async function collectReviewedPrefundedTransferProof(input: {
  settings: unknown;
  claim: unknown;
  approval: unknown;
  identityArtifact: unknown;
  transactionAuditArtifact: unknown;
  readReviewedOwnership: (claim: Claim) => Promise<unknown>;
  fetchImplementation: typeof fetch;
}) {
  try {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0)
      throw new Error('owner');
    const approval = schemas.reviewedApproval.parse(input.approval);
    const claim = prefundedCardClaimedRequestSchema.parse(input.claim);
    const now = Date.now();
    const reviewed = Date.parse(approval.reviewedAt);
    const expiry = Date.parse(approval.expiresAt);
    if (
      now >= Date.parse(target.deadline) ||
      reviewed > now ||
      now - reviewed > 60000 ||
      expiry <= now ||
      expiry > reviewed + 60000 ||
      expiry > Date.parse(target.deadline) ||
      approval.identitySha256 !== target.identitySha256 ||
      approval.transactionAuditSha256 !== target.transactionAuditSha256 ||
      !pinnedArtifact(input.identityArtifact, target.identitySha256) ||
      !pinnedArtifact(
        input.transactionAuditArtifact,
        target.transactionAuditSha256
      ) ||
      Object.entries(target.claim).some(
        ([key, value]) => claim[key as keyof Claim] !== value
      )
    )
      throw new Error('approval');
    const result = await collectPrefundedCardTransferProof({
      settings: input.settings,
      claim,
      fetchImplementation: input.fetchImplementation,
      expectedSystemIdentifier: target.systemIdentifier,
      requireRichResponse: true,
      resolveOwnership: async (selected) => {
        const proof = schemas.ownership.parse(
          await input.readReviewedOwnership(selected)
        );
        if (
          proof.crosswalk.authority !==
            'owner_reviewed_provisioning_identity' ||
          proof.crosswalk.evidenceSha256 !== target.identitySha256 ||
          proof.crosswalk.apiCustomerId !== target.apiCustomerId ||
          proof.crosswalk.webhookCustomerId !==
            target.claim.destinationCustomerId ||
          Date.parse(proof.crosswalk.expiresAt) > Date.parse(target.deadline)
        )
          throw new Error('crosswalk');
        return proof;
      },
    });
    if (
      result.outcome !== 'verified_success' ||
      result.evidence.providerTransactionId !== target.transactionId ||
      Date.now() >= expiry ||
      Date.now() >= Date.parse(target.deadline)
    )
      throw new Error('proof');
    return {
      ...result,
      verifiedAt: new Date().toISOString(),
      expiresAt: approval.expiresAt,
      identitySha256: target.identitySha256,
      transactionAuditSha256: target.transactionAuditSha256,
      writesPerformed: false as const,
    };
  } catch {
    throw new Error('REVIEWED_TRANSFER_PROOF_REFUSED');
  }
}
