import { describe, expect, it } from 'vitest';
import {
  oxygenEligibilityEvidenceQuery,
  oxygenEligibilityEvidenceRecord,
} from './oxygen-eligibility-evidence';

const workflowId = 'f1ab0000-0000-4000-8000-000000000011';
const commandId = 'f1ab0000-0000-4000-8000-000000000012';

describe('eligibility evidence query', () => {
  it('accepts an exact workflow and command binding', () => {
    expect(
      oxygenEligibilityEvidenceQuery.safeParse({ workflowId, commandId })
        .success
    ).toBe(true);
  });

  it.each([
    { workflowId: 'not-a-uuid', commandId },
    { workflowId, commandId: 'not-a-uuid' },
    { workflowId },
    { commandId },
    { workflowId: 1, commandId },
  ])('rejects an invalid or incomplete binding', (query) => {
    expect(oxygenEligibilityEvidenceQuery.safeParse(query).success).toBe(false);
  });
});

describe('eligibility evidence record', () => {
  const complete = {
    operation: 'eligibility',
    httpStatus: 200,
    eligibilityRaw: { capture: 'complete', bodyBase64: 'Zm9v' },
  };

  it.each([100, 200, 599])('accepts an HTTP status of %i', (httpStatus) => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({ ...complete, httpStatus })
        .success
    ).toBe(true);
  });

  it.each([
    99,
    600,
    200.5,
    '200',
    null,
  ])('rejects an invalid HTTP status of %s', (httpStatus) => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({ ...complete, httpStatus })
        .success
    ).toBe(false);
  });

  it('does not accept a different provider operation', () => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({
        ...complete,
        operation: 'approve',
      }).success
    ).toBe(false);
  });

  it.each([
    'oversized',
    'unavailable',
    'non_json',
    'parsed',
  ])('accepts a %s capture without a body', (capture) => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({
        ...complete,
        eligibilityRaw: { capture },
      }).success
    ).toBe(true);
  });

  it('accepts a complete capture up to the encoded size limit', () => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({
        ...complete,
        eligibilityRaw: { capture: 'complete', bodyBase64: 'A'.repeat(16000) },
      }).success
    ).toBe(true);
  });

  it.each([
    'A',
    'A===',
    'Zm9v!',
    'Zm9v\n',
    'A'.repeat(16004),
  ])('rejects malformed or oversized base64', (bodyBase64) => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({
        ...complete,
        eligibilityRaw: { capture: 'complete', bodyBase64 },
      }).success
    ).toBe(false);
  });

  it.each([
    { capture: 'complete' },
    { capture: 'unknown' },
    {},
    null,
  ])('rejects a missing or unsupported capture shape', (eligibilityRaw) => {
    expect(
      oxygenEligibilityEvidenceRecord.safeParse({ ...complete, eligibilityRaw })
        .success
    ).toBe(false);
  });
});
