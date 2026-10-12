import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AcceptanceEvidenceSchema } from './acceptance.mjs';

function template() {
  return JSON.parse(
    readFileSync(
      new URL('../acceptance.template.json', import.meta.url),
      'utf8'
    )
  );
}

test('parses the disabled template without authorizing any acceptance gate', () => {
  const evidence = template();
  const result = AcceptanceEvidenceSchema.safeParse(evidence);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, evidence);
  assert.equal(result.data.project.authenticated, false);
  assert.equal(result.data.interest.providerPaidReceiptVerified, false);
});

test('parses synthetic metadata with valid timestamps, identifiers, fingerprints and net amount', () => {
  const evidence = template();
  evidence.observedAt = '2026-10-02T12:00:00Z';
  evidence.project.projectId = '22222222-2222-4222-8222-222222222222';
  evidence.project.inventorySha256 = 'a'.repeat(64);
  evidence.device.platform = 'android';
  evidence.device.applicationId = 'com.ogabassey.staging';
  evidence.interest.netAmountKobo = 733;
  assert.equal(AcceptanceEvidenceSchema.safeParse(evidence).success, true);
});

test('rejects unknown fields at the root and in every nested evidence section', () => {
  const evidence = template();
  evidence.token = 'synthetic-forbidden-token';
  assert.equal(AcceptanceEvidenceSchema.safeParse(evidence).success, false);
  for (const section of Object.keys(template()).filter(
    (field) => field !== 'observedAt'
  )) {
    const candidate = template();
    candidate[section].token = 'synthetic-forbidden-token';
    assert.equal(
      AcceptanceEvidenceSchema.safeParse(candidate).success,
      false,
      section
    );
  }
});

test('rejects missing required sections and fields instead of defaulting acceptance evidence', () => {
  for (const section of Object.keys(template())) {
    const candidate = template();
    delete candidate[section];
    assert.equal(
      AcceptanceEvidenceSchema.safeParse(candidate).success,
      false,
      section
    );
  }
  for (const [section, fields] of Object.entries(template())) {
    if (section === 'observedAt') continue;
    for (const field of Object.keys(fields)) {
      const candidate = template();
      delete candidate[section][field];
      assert.equal(
        AcceptanceEvidenceSchema.safeParse(candidate).success,
        false,
        `${section}.${field}`
      );
    }
  }
});

test('rejects malformed optional metadata while preserving null as unobserved evidence', () => {
  for (const [section, field, values] of [
    ['project', 'projectId', ['', 'not-a-uuid']],
    ['build', 'buildId', ['', 'not-a-uuid']],
    ['build', 'projectId', ['', 'not-a-uuid']],
    ['build', 'platform', ['simulator', 'web']],
    ['device', 'installedBuildId', ['', 'not-a-uuid']],
    ['device', 'platform', ['simulator', 'web']],
    ['device', 'applicationId', ['']],
    ['interest', 'netAmountKobo', [0, -1, 1.5, '733']],
  ]) {
    for (const value of values) {
      const candidate = template();
      candidate[section][field] = value;
      assert.equal(
        AcceptanceEvidenceSchema.safeParse(candidate).success,
        false,
        `${section}.${field}`
      );
    }
  }
  const invalidDate = template();
  invalidDate.observedAt = '2026-10-02';
  assert.equal(AcceptanceEvidenceSchema.safeParse(invalidDate).success, false);
  assert.equal(AcceptanceEvidenceSchema.safeParse(template()).success, true);
});

test('rejects malformed fingerprints in all evidence hash fields', () => {
  for (const [section, fields] of Object.entries(template())) {
    if (section === 'observedAt') continue;
    for (const field of Object.keys(fields).filter((name) =>
      name.endsWith('Sha256')
    )) {
      for (const value of [
        'a'.repeat(63),
        'A'.repeat(64),
        'g'.repeat(64),
        123,
      ]) {
        const candidate = template();
        candidate[section][field] = value;
        assert.equal(
          AcceptanceEvidenceSchema.safeParse(candidate).success,
          false,
          `${section}.${field}`
        );
      }
    }
  }
});

test('rejects nonboolean acceptance assertions in all evidence sections', () => {
  for (const [section, fields] of Object.entries(template())) {
    if (section === 'observedAt' || section === 'protectedState') continue;
    for (const [field, value] of Object.entries(fields)) {
      if (typeof value !== 'boolean') continue;
      const candidate = template();
      candidate[section][field] = 'true';
      assert.equal(
        AcceptanceEvidenceSchema.safeParse(candidate).success,
        false,
        `${section}.${field}`
      );
    }
  }
});

test('rejects changes to every protected financial and readonly checkout literal', () => {
  for (const [field, value] of Object.entries(template().protectedState)) {
    const candidate = template();
    candidate.protectedState[field] =
      typeof value === 'number' ? value + 1 : !value;
    assert.equal(
      AcceptanceEvidenceSchema.safeParse(candidate).success,
      false,
      field
    );
  }
});
