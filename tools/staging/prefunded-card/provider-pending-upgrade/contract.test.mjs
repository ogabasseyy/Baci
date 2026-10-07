import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { authority } from './constants.mjs';
import { reviewContract } from './contract.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const originalSources = {
    [authority.provider]: 'a'.repeat(64),
    'unchanged.ts': 'b'.repeat(64),
  };
  const baseline = {
    financialSealSha256: authority.financialSealSha256,
    deadline: authority.deadline,
    providerSha256: 'a'.repeat(64),
    budgetKobo: 10000,
    principalKobo: 10000,
    mutationsEnabled: false,
    public: {
      archiveSha256: authority.publicArchiveSha256,
      manifestSha256: authority.publicManifestSha256,
      launcherSha256: authority.launcherSha256,
      sourceManifestSha256: authority.publicSourceManifestSha256,
      sources: originalSources,
    },
    background: {
      manifestSha256: 'c'.repeat(64),
      codeSha256: 'd'.repeat(64),
      sources: originalSources,
    },
  };
  const candidate = structuredClone(baseline);
  candidate.providerSha256 = authority.providerSha256;
  candidate.public.integratedNextStandalone = true;
  candidate.public.archiveSha256 = 'e'.repeat(64);
  candidate.public.manifestSha256 = 'f'.repeat(64);
  candidate.background.codeSha256 = '1'.repeat(64);
  candidate.background.manifestSha256 = '2'.repeat(64);
  candidate.public.sources[authority.provider] = authority.providerSha256;
  candidate.background.sources[authority.provider] = authority.providerSha256;
  const baselineBytes = Buffer.from(JSON.stringify(baseline));
  const candidateBytes = Buffer.from(JSON.stringify(candidate));
  const approved = {
    baselineSha256: digest(baselineBytes),
    candidateSha256: digest(candidateBytes),
    predecessorProviderSha256: baseline.providerSha256,
  };
  const evidence = {
    observedAt: now,
    baselineSha256: approved.baselineSha256,
    candidateSha256: approved.candidateSha256,
    exclusiveUpgradeLock: true,
    schedulersStopped: true,
    noInflightProviderRequests: true,
    rollbackRetained: true,
    exactTreeMetadataVerified: true,
    imagesAndMountsVerified: true,
    unauthenticated: { GET: 401, POST: 401, PATCH: 401 },
    authenticatedReadonly: {
      GET: 200,
      enabled: false,
      maximumAmountKobo: 0,
      POST: 503,
      PATCH: 503,
    },
    protectedBefore: { financial: '3'.repeat(64) },
    protectedAfter: { financial: '3'.repeat(64) },
  };
  return {
    baseline,
    candidate,
    baselineBytes,
    candidateBytes,
    approved,
    evidence,
    now,
  };
}

test('accepts only the independently pinned predecessor and complete provider-only delta', () => {
  const sample = fixture();
  const result = reviewContract(
    sample.baselineBytes,
    sample.candidateBytes,
    sample.approved,
    sample.evidence,
    sample.now
  );
  assert.equal(result.changesApplied, false);
  assert.equal(result.executableInstaller, false);
});

test('refuses unauthenticated access, stale evidence, inflight calls, missing rollback and state drift', () => {
  for (const mutate of [
    (value) => {
      value.evidence.unauthenticated.POST = 200;
    },
    (value) => {
      value.evidence.observedAt -= 60_001;
    },
    (value) => {
      value.evidence.noInflightProviderRequests = false;
    },
    (value) => {
      value.evidence.rollbackRetained = false;
    },
    (value) => {
      value.evidence.protectedAfter.financial = '4'.repeat(64);
    },
    (value) => {
      value.approved.baselineSha256 = '5'.repeat(64);
    },
    (value) => {
      value.now = Date.parse(authority.deadline);
    },
  ]) {
    const sample = fixture();
    mutate(sample);
    assert.throws(() =>
      reviewContract(
        sample.baselineBytes,
        sample.candidateBytes,
        sample.approved,
        sample.evidence,
        sample.now
      )
    );
  }
});

test('refuses a naked handler, unrelated source change and a different original r8 seal even if repinned', () => {
  for (const mutate of [
    (value) => {
      value.candidate.public.integratedNextStandalone = false;
    },
    (value) => {
      value.candidate.background.sources['unchanged.ts'] = '6'.repeat(64);
    },
    (value) => {
      value.candidate.financialSealSha256 = '7'.repeat(64);
    },
    (value) => {
      value.baseline.public.archiveSha256 = '8'.repeat(64);
    },
  ]) {
    const sample = fixture();
    mutate(sample);
    sample.baselineBytes = Buffer.from(JSON.stringify(sample.baseline));
    sample.candidateBytes = Buffer.from(JSON.stringify(sample.candidate));
    sample.approved.baselineSha256 = digest(sample.baselineBytes);
    sample.approved.candidateSha256 = digest(sample.candidateBytes);
    sample.evidence.baselineSha256 = sample.approved.baselineSha256;
    sample.evidence.candidateSha256 = sample.approved.candidateSha256;
    assert.throws(() =>
      reviewContract(
        sample.baselineBytes,
        sample.candidateBytes,
        sample.approved,
        sample.evidence,
        sample.now
      )
    );
  }
});
