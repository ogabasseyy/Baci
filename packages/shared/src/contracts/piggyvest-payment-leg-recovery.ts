import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const observation = z.strictObject({
  observationId: uuid,
  leg: z.enum(['savings', 'other']),
  reason: z.enum([
    'contract_unconfirmed',
    'outcome_unconfirmed',
    'compensation_unresolved',
    'reference_unverified',
  ]),
  recordedAt: z.iso.datetime({ offset: true }),
});
const leg = z
  .strictObject({
    operationId: uuid,
    leg: z.enum(['savings', 'other']),
    referenceType: z.literal('local_intent_leg'),
    amountKobo: z.number().int().safe().nonnegative(),
    outcome: z.enum(['unknown', 'not_required']),
    providerReference: z.null(),
    observationCount: z.number().int().safe().nonnegative(),
    latestObservation: observation.nullable(),
  })
  .superRefine((value, context) => {
    if (
      (value.amountKobo === 0) !== (value.outcome === 'not_required') ||
      (value.leg === 'savings' && value.amountKobo === 0) ||
      (value.amountKobo === 0 && value.observationCount !== 0) ||
      (value.observationCount === 0) !== (value.latestObservation === null) ||
      (value.latestObservation && value.latestObservation.leg !== value.leg)
    )
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent internal leg',
      });
  });

export const piggyvestPaymentLegRecoverySchema = z
  .strictObject({
    completion: z.literal('metadata_only'),
    financialEffects: z.literal('UNKNOWN'),
    dispatch: z.literal('disabled'),
    retry: z.literal('not_authorized'),
    compensation: z.literal('not_authorized'),
    reasonEvidence: z.literal('reported_unresolved_only'),
    legs: z.tuple([leg, leg]),
    historicalObservation: observation.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.legs[0].leg !== 'savings' ||
      value.legs[1].leg !== 'other' ||
      value.legs[0].operationId !== value.legs[1].operationId ||
      (value.historicalObservation?.leg === 'other' &&
        value.legs[1].amountKobo === 0)
    )
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent recovery references',
      });
  });
