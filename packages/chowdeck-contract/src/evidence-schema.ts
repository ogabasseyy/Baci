import { assertSafeEvidenceOutput } from './assert-safe-evidence-output';
import {
  digestArtifact,
  parseCanonicalJson,
} from './canonical-artifact-digest';

export { assertSafeEvidenceOutput } from './assert-safe-evidence-output';

import {
  type ChowdeckEvidenceClaimV1,
  type ChowdeckEvidenceManifestInputV1,
  type ChowdeckEvidenceManifestV1,
  evidenceManifestInputSchema,
  evidenceManifestSchema,
} from './schemas/evidence-schema';

function invalidEvidence(): never {
  throw new Error('Invalid evidence manifest');
}

function stableProjection(input: ChowdeckEvidenceManifestInputV1): unknown {
  return {
    contractVersion: input.contractVersion,
    captureToolDigest: input.captureToolDigest,
    claims: input.claims,
    limitations: input.limitations,
  };
}

export function computeEvidenceDigests(
  input: ChowdeckEvidenceManifestInputV1
): ChowdeckEvidenceManifestV1 {
  try {
    assertSafeEvidenceOutput(input);
    const validated = evidenceManifestInputSchema.parse(input);
    const sanitizedProjectionDigest = digestArtifact(
      stableProjection(validated)
    );
    const digest = digestArtifact({ ...validated, sanitizedProjectionDigest });
    const result = { ...validated, sanitizedProjectionDigest, digest };
    assertSafeEvidenceOutput(result);
    return evidenceManifestSchema.parse(result);
  } catch {
    return invalidEvidence();
  }
}

export function parseEvidenceManifest(
  input: string | unknown
): ChowdeckEvidenceManifestV1 {
  try {
    const decoded =
      typeof input === 'string' ? parseCanonicalJson(input) : input;
    assertSafeEvidenceOutput(decoded);
    const manifest = evidenceManifestSchema.parse(decoded);
    const recomputed = computeEvidenceDigests({
      contractVersion: manifest.contractVersion,
      capturedAt: manifest.capturedAt,
      captureToolDigest: manifest.captureToolDigest,
      runMetrics: manifest.runMetrics,
      claims: manifest.claims,
      limitations: manifest.limitations,
    });
    if (
      recomputed.sanitizedProjectionDigest !==
        manifest.sanitizedProjectionDigest ||
      recomputed.digest !== manifest.digest
    ) {
      invalidEvidence();
    }
    return manifest;
  } catch {
    return invalidEvidence();
  }
}

export type {
  ChowdeckEvidenceClaimV1,
  ChowdeckEvidenceManifestInputV1,
  ChowdeckEvidenceManifestV1,
};
