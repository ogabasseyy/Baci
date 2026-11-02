import { describe, expect, it } from 'vitest';

import { classifyOxygenEligibility } from './eligibility';

describe('classifyOxygenEligibility', () => {
  it('classifies the documented affirmative shape as eligible with the raw provider amount', () => {
    expect(
      classifyOxygenEligibility({
        eligible_amount: 660000,
        response: 'Congratulations! You are eligible for a loan.',
        successful: true,
        eligible: true,
      })
    ).toEqual({ kind: 'eligible', eligibleAmount: 660000 });
  });

  it('classifies the documented credit-score-retrieval shape as pending', () => {
    expect(
      classifyOxygenEligibility({
        timestamp: '2026-03-17T11:17:05.208862408Z[UTC]',
        path: '',
        message: 'Almost there! We are retrieving your credit score',
        errors: null,
        response_code: '99',
        status: 400,
        error: 'Bad Request',
      })
    ).toEqual({ kind: 'pending' });
  });

  it.each([
    ['different response code', { status: 400, response_code: '01' }],
    ['missing response code', { status: 400, message: 'Bad Request' }],
    ['missing status', { response_code: '99' }],
  ])('classifies a 400 that is not the documented pending shape as unknown (%s)', (_label, body) => {
    expect(classifyOxygenEligibility(body)).toEqual({ kind: 'unknown' });
  });

  it.each([
    [null],
    [undefined],
    ['eligible'],
    [42],
    [[]],
    [{}],
  ])('classifies malformed bodies as unknown (%s)', (body) => {
    expect(classifyOxygenEligibility(body)).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['explicit negative', { successful: false, eligible: false }],
    ['contradictory success flags', { successful: true, eligible: false }],
    ['contradictory eligibility flags', { successful: false, eligible: true }],
    [
      'zero limit on an affirmative shape',
      { successful: true, eligible: true, eligible_amount: 0 },
    ],
    [
      'negative limit on an affirmative shape',
      { successful: true, eligible: true, eligible_amount: -5 },
    ],
    [
      'non-finite limit on an affirmative shape',
      { successful: true, eligible: true, eligible_amount: Number.NaN },
    ],
    [
      'string limit on an affirmative shape',
      { successful: true, eligible: true, eligible_amount: '660000' },
    ],
    [
      'missing limit on an affirmative shape',
      { successful: true, eligible: true },
    ],
    [
      'numeric pending code instead of documented string',
      { status: 400, response_code: 99 },
    ],
  ])('classifies %s as unknown (fail closed)', (_label, body) => {
    expect(classifyOxygenEligibility(body)).toEqual({ kind: 'unknown' });
  });

  it('tolerates extra provider fields on the documented affirmative shape', () => {
    expect(
      classifyOxygenEligibility({
        eligible_amount: 660000,
        response: 'Congratulations! You are eligible for a loan.',
        successful: true,
        eligible: true,
        future_provider_field: 'added later',
      })
    ).toEqual({ kind: 'eligible', eligibleAmount: 660000 });
  });

  it('tolerates extra provider fields on the documented pending shape', () => {
    expect(
      classifyOxygenEligibility({
        status: 400,
        response_code: '99',
        future_provider_field: 'added later',
      })
    ).toEqual({ kind: 'pending' });
  });
});

describe('conflicting eligibility evidence', () => {
  it.each([
    {
      successful: true,
      eligible: true,
      eligible_amount: 660000,
      message: 'Almost there! We are retrieving your credit score',
    },
    {
      status: 400,
      response_code: '99',
      response: 'Congratulations! You are eligible for a loan.',
    },
    {
      successful: true,
      eligible: true,
      eligible_amount: 660000,
      status: 400,
      response_code: '99',
    },
    { successful: true, eligible: true, eligible_amount: 660000, status: 500 },
    {
      successful: true,
      eligible: true,
      eligible_amount: 660000,
      errors: ['failed'],
    },
    { status: 400, response_code: '99', eligible: false },
    { status: 400, response_code: '99', successful: false },
    { status: 400, response_code: '99', eligible_amount: 660000 },
  ])('keeps contradictory evidence unknown: %j', (body) => {
    expect(classifyOxygenEligibility(body)).toEqual({ kind: 'unknown' });
  });
});
