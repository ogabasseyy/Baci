import assert from 'node:assert/strict';
import { it } from 'node:test';
import { remediationArtifactKeyFor } from './remediation-artifact-key.mjs';

it('returns a bounded safe key for the canonical remediation case', () => {
  const artifactKey = remediationArtifactKeyFor({
    caseKey: `vercel:vercel_timeout:${'shared/'.repeat(80)}`,
  });

  assert.match(artifactKey, /^vercel-vercel_timeout-/);
  assert.match(artifactKey, /^[a-zA-Z0-9_-]+$/);
  assert.ok(artifactKey.length <= 180);
});

it('passes through a short sanitized case key', () => {
  const artifactKey = remediationArtifactKeyFor({
    caseKey: 'vercel:vercel_timeout:abc-123',
  });

  assert.equal(artifactKey, 'vercel-vercel_timeout-abc-123');
  assert.ok(artifactKey.length <= 180);
});

it('composes a key from source, category, and fingerprint without a case key', () => {
  const artifactKey = remediationArtifactKeyFor({
    category: 'vercel_timeout',
    fingerprint: 'abc-123',
    source: 'vercel',
  });

  assert.equal(artifactKey, 'vercel-vercel_timeout-abc-123');
  assert.ok(artifactKey.length <= 180);
});
