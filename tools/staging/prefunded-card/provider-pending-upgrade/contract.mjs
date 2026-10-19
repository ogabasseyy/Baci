import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authority } from './constants.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const requireGate = (condition, name) => {
  if (!condition) throw new Error(name);
};

export function reviewContract(
  baselineBytes,
  candidateBytes,
  approved,
  evidence,
  now
) {
  requireGate(
    Number.isFinite(now) &&
      now > 0 &&
      now < Date.parse(authority.deadline) - 600_000,
    'deadline-window-refused'
  );
  requireGate(
    hex.test(approved.baselineSha256) &&
      hex.test(approved.candidateSha256) &&
      digest(baselineBytes) === approved.baselineSha256 &&
      digest(candidateBytes) === approved.candidateSha256,
    'independent-review-pins-required'
  );
  const baseline = JSON.parse(baselineBytes);
  const candidate = JSON.parse(candidateBytes);
  requireGate(
    baseline.financialSealSha256 === authority.financialSealSha256 &&
      candidate.financialSealSha256 === authority.financialSealSha256 &&
      baseline.deadline === authority.deadline &&
      candidate.deadline === authority.deadline,
    'original-r8-authority-required'
  );
  requireGate(
    baseline.public.archiveSha256 === authority.publicArchiveSha256 &&
      baseline.public.manifestSha256 === authority.publicManifestSha256 &&
      baseline.public.launcherSha256 === authority.launcherSha256 &&
      baseline.public.sourceManifestSha256 ===
        authority.publicSourceManifestSha256,
    'exact-public-predecessor-required'
  );
  requireGate(
    candidate.public.integratedNextStandalone === true &&
      hex.test(candidate.public.archiveSha256) &&
      hex.test(candidate.public.manifestSha256) &&
      candidate.public.archiveSha256 !== baseline.public.archiveSha256 &&
      candidate.public.manifestSha256 !== baseline.public.manifestSha256 &&
      candidate.public.launcherSha256 === authority.launcherSha256,
    'integrated-public-release-required'
  );
  requireGate(
    hex.test(baseline.providerSha256) &&
      approved.predecessorProviderSha256 === baseline.providerSha256 &&
      baseline.providerSha256 !== authority.providerSha256 &&
      candidate.providerSha256 === authority.providerSha256,
    'provider-delta-required'
  );
  for (const kind of ['public', 'background']) {
    const oldSources = baseline[kind].sources;
    const newSources = candidate[kind].sources;
    requireGate(
      oldSources && newSources && Object.keys(oldSources).length > 1,
      'complete-source-closures-required'
    );
    assert.deepEqual(
      Object.keys(oldSources).sort(),
      Object.keys(newSources).sort(),
      'source-file-set-drift'
    );
    requireGate(
      oldSources[authority.provider] === baseline.providerSha256 &&
        newSources[authority.provider] === authority.providerSha256,
      'provider-closure-pin-required'
    );
    for (const [name, expected] of Object.entries(oldSources)) {
      requireGate(
        hex.test(expected) && hex.test(newSources[name]),
        'source-pin-required'
      );
      if (name !== authority.provider)
        requireGate(expected === newSources[name], 'unrelated-source-drift');
    }
  }
  for (const state of [baseline, candidate]) {
    requireGate(
      hex.test(state.background.manifestSha256) &&
        hex.test(state.background.codeSha256) &&
        state.budgetKobo === 10000 &&
        state.principalKobo === 10000 &&
        state.mutationsEnabled === false,
      'financial-bounds-required'
    );
  }
  requireGate(
    baseline.background.codeSha256 !== candidate.background.codeSha256,
    'background-upgrade-required'
  );
  requireGate(
    Number.isFinite(evidence.observedAt) &&
      now - evidence.observedAt >= 0 &&
      now - evidence.observedAt <= 60_000,
    'fresh-parent-evidence-required'
  );
  requireGate(
    evidence.baselineSha256 === approved.baselineSha256 &&
      evidence.candidateSha256 === approved.candidateSha256,
    'evidence-chain-drift'
  );
  requireGate(
    evidence.exclusiveUpgradeLock === true &&
      evidence.schedulersStopped === true &&
      evidence.noInflightProviderRequests === true &&
      evidence.rollbackRetained === true &&
      evidence.exactTreeMetadataVerified === true &&
      evidence.imagesAndMountsVerified === true,
    'transaction-preconditions-required'
  );
  assert.deepEqual(
    evidence.unauthenticated,
    { GET: 401, POST: 401, PATCH: 401 },
    'unauthenticated-gates-required'
  );
  assert.deepEqual(
    evidence.authenticatedReadonly,
    {
      GET: 200,
      enabled: false,
      maximumAmountKobo: 0,
      POST: 503,
      PATCH: 503,
    },
    'public-readonly-gates-required'
  );
  requireGate(
    evidence.protectedBefore &&
      Object.keys(evidence.protectedBefore).length > 0 &&
      Object.values(evidence.protectedBefore).every((value) => hex.test(value)),
    'protected-baseline-required'
  );
  assert.deepEqual(
    evidence.protectedBefore,
    evidence.protectedAfter,
    'protected-state-drift'
  );
  return {
    status: 'parent-reviewed-contract-only',
    deadline: authority.deadline,
    predecessor: approved.baselineSha256,
    successor: approved.candidateSha256,
    changesApplied: false,
    executableInstaller: false,
  };
}
