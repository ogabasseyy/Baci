import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptanceSchema } from './acceptance-schema.mjs';

function input() {
  return {
    schemaVersion: 1,
    evidence: [
      {
        id: 'contract',
        category: 'tested',
        kind: 'synthetic-result',
        path: 'tools/staging/interest-bridge/contract-e2e/result-20261002.json',
        sha256: 'a'.repeat(64),
      },
    ],
  };
}

test('defaults to read-only with explicit evidence path and digest', () => {
  const candidate = input();
  const parsed = acceptanceSchema.parse(candidate);
  assert.equal(parsed.mode, 'read-only');
  assert.deepEqual(parsed.evidence, candidate.evidence);
  assert.notEqual(parsed.evidence[0], candidate.evidence[0]);
});

test('accepts absent proofs as empty evidence without inventing completion', () => {
  assert.deepEqual(
    acceptanceSchema.parse({ schemaVersion: 1, evidence: [] }).evidence,
    []
  );
});

test('refuses boolean full-completion and verification assertions', () => {
  for (const field of [
    'fullCompletion',
    'actualAcceptance',
    'sourceIntegrationReady',
  ]) {
    assert.throws(() => acceptanceSchema.parse({ ...input(), [field]: true }));
  }
  const candidate = input();
  candidate.evidence[0].verified = true;
  assert.throws(() => acceptanceSchema.parse(candidate));
});

test('refuses fixture promotion to genuine provider or device evidence', () => {
  for (const category of [
    'genuineProvider',
    'device',
    'liveAuth',
    'financial',
  ]) {
    const candidate = input();
    candidate.evidence[0].category = category;
    assert.throws(() => acceptanceSchema.parse(candidate));
  }
});

test('requires a safe local path and SHA-256 for every evidence record', () => {
  for (const path of [
    '/root/proof.json',
    'https://example.com/proof',
    'tools/staging/../proof.json',
    'tools/staging/.env',
    'tools/staging//proof.json',
    'tools/staging/./proof.json',
    'apps/web/src/proof.json',
    'tools/staging/proof\\file.json',
    '',
  ]) {
    const candidate = input();
    candidate.evidence[0].path = path;
    assert.throws(() => acceptanceSchema.parse(candidate));
  }
  for (const sha256 of [
    undefined,
    null,
    true,
    'a'.repeat(63),
    'A'.repeat(64),
  ]) {
    const candidate = input();
    candidate.evidence[0].sha256 = sha256;
    assert.throws(() => acceptanceSchema.parse(candidate));
  }
});

test('refuses duplicate IDs, unsupported categories and malformed schema', () => {
  const duplicate = input();
  duplicate.evidence.push({ ...duplicate.evidence[0] });
  assert.throws(() => acceptanceSchema.parse(duplicate));
  for (const category of ['providerPass', '__proto__', null]) {
    const candidate = input();
    candidate.evidence[0].category = category;
    assert.throws(() => acceptanceSchema.parse(candidate));
  }
  for (const candidate of [null, [], {}, { schemaVersion: 2, evidence: [] }]) {
    assert.throws(() => acceptanceSchema.parse(candidate));
  }
});

test('refuses mutation mode and caller-selected financial authority', () => {
  assert.throws(() => acceptanceSchema.parse({ ...input(), mode: 'apply' }));
  for (const field of [
    'deadline',
    'oldPrincipalKobo',
    'globalCompanySandboxBudgetKobo',
  ]) {
    assert.throws(() => acceptanceSchema.parse({ ...input(), [field]: 20000 }));
  }
});
