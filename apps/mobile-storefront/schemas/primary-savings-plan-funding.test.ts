import { expect, it } from '@jest/globals';
import { PrimarySavingsPlanFundingSchemas as schemas } from './primary-savings-plan-funding';

const selection = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  goalId: '22222222-2222-4222-8222-222222222222',
};

it('requires explicit consent and an explicit interest choice', () => {
  expect(schemas.request.safeParse(selection).success).toBe(false);
  expect(
    schemas.request.safeParse({ ...selection, consent: true }).success
  ).toBe(false);
  expect(
    schemas.request.safeParse({
      ...selection,
      consent: true,
      interestAccepted: false,
    }).success
  ).toBe(true);
});

it('rejects BVN and other unexpected fields on primary provisioning', () => {
  expect(
    schemas.request.safeParse({
      ...selection,
      consent: true,
      interestAccepted: true,
      bvn: '00000000000',
    }).success
  ).toBe(false);
});

it('does not accept a ready response without a funding account', () => {
  expect(
    schemas.response.safeParse({ goalId: selection.goalId, status: 'ready' })
      .success
  ).toBe(false);
  expect(
    schemas.response.safeParse({ goalId: selection.goalId, status: 'pending' })
      .success
  ).toBe(true);
});

it('rejects malformed account numbers in a ready response', () => {
  expect(
    schemas.response.safeParse({
      goalId: selection.goalId,
      status: 'ready',
      accounts: [
        { accountNumber: '123', accountName: 'Test', bankName: 'Test Bank' },
      ],
    }).success
  ).toBe(false);
});

it('does not expose funding accounts from an unconfirmed response', () => {
  expect(
    schemas.response.safeParse({
      goalId: selection.goalId,
      status: 'pending',
      accounts: [
        {
          accountNumber: '1234567890',
          accountName: 'Test',
          bankName: 'Test Bank',
        },
      ],
    }).success
  ).toBe(false);
});
