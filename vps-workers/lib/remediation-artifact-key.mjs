import { createHash } from 'node:crypto';

const MAX_ARTIFACT_KEY_LENGTH = 180;

const safeArtifactKey = (value) =>
  String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

export function remediationArtifactKeyFor(candidate) {
  const caseKey =
    candidate?.caseKey ||
    `${candidate?.source || 'unknown'}:${candidate?.category || 'unknown'}:${candidate?.fingerprint || 'unknown'}`;
  const artifactKey = safeArtifactKey(caseKey);
  if (artifactKey.length <= MAX_ARTIFACT_KEY_LENGTH) return artifactKey;
  const suffix = createHash('sha256')
    .update(artifactKey)
    .digest('hex')
    .slice(0, 16);
  return `${artifactKey.slice(0, MAX_ARTIFACT_KEY_LENGTH - suffix.length - 1)}-${suffix}`;
}
