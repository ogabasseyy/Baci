import { expect, it } from 'vitest';
import { piggyvestPaymentLegRecoverySchema as schema } from './piggyvest-payment-leg-recovery';

const id = 'abcdefab-0000-4000-8000-000000000001';
const metadata = {
  completion: 'metadata_only',
  financialEffects: 'UNKNOWN',
  dispatch: 'disabled',
  retry: 'not_authorized',
  compensation: 'not_authorized',
  reasonEvidence: 'reported_unresolved_only',
  historicalObservation: null,
  legs: [
    {
      operationId: id,
      leg: 'savings',
      referenceType: 'local_intent_leg',
      amountKobo: 97000,
      outcome: 'unknown',
      providerReference: null,
      observationCount: 0,
      latestObservation: null,
    },
    {
      operationId: id,
      leg: 'other',
      referenceType: 'local_intent_leg',
      amountKobo: 0,
      outcome: 'not_required',
      providerReference: null,
      observationCount: 0,
      latestObservation: null,
    },
  ],
};
it('retains exact internal tuple and zero other leg without provider authority', () => {
  expect(schema.parse(metadata)).toEqual(metadata);
  expect(
    schema.parse({
      ...metadata,
      legs: metadata.legs.map((leg) => ({
        ...leg,
        operationId: id.toUpperCase(),
      })),
    })
  ).toEqual(metadata);
});
it.each([
  { financialEffects: 'confirmed' },
  { compensation: 'complete' },
  { retry: 'allowed' },
  { dispatch: 'submitted' },
  { actorId: id },
  { providerPayload: {} },
])('rejects private fields and terminal authority %j', (patch) => {
  expect(schema.safeParse({ ...metadata, ...patch }).success).toBe(false);
});
it.each([
  { amountKobo: -1 },
  { amountKobo: 0.1 },
  { amountKobo: Number.MAX_SAFE_INTEGER + 1 },
  { amountKobo: 0 },
  { outcome: 'success' },
  { providerReference: 'unverified' },
  { observationCount: 1 },
  { leg: 'other' },
])('rejects malformed or inconsistent leg %j', (patch) => {
  expect(
    schema.safeParse({
      ...metadata,
      legs: [{ ...metadata.legs[0], ...patch }, metadata.legs[1]],
    }).success
  ).toBe(false);
});
it('accepts unresolved historical reasons but rejects fabricated chronology or irrelevant absent leg observations', () => {
  const observation = {
    observationId: id,
    leg: 'savings',
    reason: 'compensation_unresolved',
    recordedAt: '2026-09-12T00:00:00Z',
  };
  const value = {
    ...metadata,
    historicalObservation: observation,
    legs: [
      {
        ...metadata.legs[0],
        observationCount: 1,
        latestObservation: observation,
      },
      metadata.legs[1],
    ],
  };
  expect(schema.safeParse(value).success).toBe(true);
  expect(
    schema.safeParse({
      ...value,
      historicalObservation: { ...observation, leg: 'other' },
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      historicalObservation: { ...observation, recordedAt: 'yesterday' },
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      historicalObservation: { ...observation, reason: 'refunded' },
    }).success
  ).toBe(false);
});
