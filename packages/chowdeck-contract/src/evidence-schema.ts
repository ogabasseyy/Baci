import {
  digestArtifact,
  parseCanonicalJson,
} from './canonical-artifact-digest';
import { hasPrivateHost } from './has-private-host';
import {
  type ChowdeckEvidenceClaimV1,
  type ChowdeckEvidenceManifestInputV1,
  type ChowdeckEvidenceManifestV1,
  evidenceManifestInputSchema,
  evidenceManifestSchema,
} from './schemas/evidence-schema';

const UNSAFE_KEY =
  /authorization|token|secret|password|apikey|email|headers?|body|rawsource|sourcedigest|environment/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const CREDENTIAL = /(?:bearer\s+|sk[_-]|api[_-]?key\s*[:=])[^\s]{8,}/i;
const SUPABASE_REFERENCE = /\b[a-z0-9]{20}\.supabase\.co\b/i;
const RESERVED_IDENTIFIER =
  /^(?:authorization|token|secret|password|api_?key|email|headers?|body|raw_source_digest|environment)$/i;

function scan(value: unknown): void {
  if (typeof value === 'string') {
    if (
      EMAIL.test(value) ||
      CREDENTIAL.test(value) ||
      SUPABASE_REFERENCE.test(value) ||
      RESERVED_IDENTIFIER.test(value) ||
      hasPrivateHost(value)
    ) {
      throw new Error('Invalid evidence manifest');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) scan(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key.replaceAll('_', ''))) {
      throw new Error('Invalid evidence manifest');
    }
    scan(entry);
  }
}

export function assertSafeEvidenceOutput(value: unknown): void {
  scan(value);
}

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
