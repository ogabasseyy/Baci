import { expect, it } from 'vitest';
import { prefundedCardCustomerSchemas as schemas } from './prefunded-card-customer';

const identity = '10000000-0000-4000-8000-000000000001';
const input = {
  goalId: identity,
  savedMethodId: identity,
  idempotencyKey: identity,
  amountKobo: 100,
  consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
};

it('accepts only a saved method reference and integer kobo', () => {
  expect(schemas.request.parse(input)).toEqual(input);
});

it.each([
  0,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
])('rejects invalid amount %s', (amountKobo) => {
  expect(schemas.request.safeParse({ ...input, amountKobo }).success).toBe(
    false
  );
});

it.each([
  'authorizationCode',
  'merchantId',
  'customerId',
  'sourceWalletId',
  'currency',
])('rejects caller-selected authority %s', (key) => {
  expect(schemas.request.safeParse({ ...input, [key]: identity }).success).toBe(
    false
  );
});

it('does not expose provider secret or evidence fields in customer results', () => {
  const result = {
    operationId: identity,
    goalId: identity,
    amountKobo: 100,
    currency: 'NGN',
    status: 'pending',
  };
  expect(schemas.result.parse(result)).toEqual(result);
  expect(
    schemas.result.safeParse({ ...result, authorizationCode: 'secret' }).success
  ).toBe(false);
});

it.each([
  undefined,
  null,
  {},
  { version: 'prefunded-card-v1', oneTimeCharge: false },
  { version: 'prefunded-card-v1', oneTimeCharge: 'true' },
  { version: 'another-version', oneTimeCharge: true },
  { version: 'prefunded-card-v1', oneTimeCharge: true, actorId: identity },
])('requires exact explicit one-time saved-card consent', (consent) => {
  expect(schemas.request.safeParse({ ...input, consent }).success).toBe(false);
});

it('distinguishes goal-only capability selection from idempotent status selection', () => {
  expect(schemas.selection.parse({ goalId: identity })).toEqual({
    goalId: identity,
  });
  expect(
    schemas.selection.parse({ goalId: identity, idempotencyKey: identity })
  ).toEqual({
    goalId: identity,
    idempotencyKey: identity,
  });
  expect(
    schemas.selection.safeParse({ goalId: identity, idempotencyKey: '' })
      .success
  ).toBe(false);
  expect(
    schemas.selection.safeParse({ goalId: identity, savedMethodId: identity })
      .success
  ).toBe(false);
});

it('bounds the capability contract without accepting first-card or secret fields', () => {
  const capability = {
    goalId: identity,
    enabled: true,
    newCardEnabled: false,
    currency: 'NGN',
    maximumAmountKobo: 100,
    savedMethods: [{ id: identity, brand: 'visa', last4: '4081' }],
  };
  expect(schemas.capability.parse(capability)).toEqual(capability);
  for (const change of [
    { maximumAmountKobo: -1 },
    { maximumAmountKobo: 0 },
    { maximumAmountKobo: Number.MAX_SAFE_INTEGER + 1 },
    { maximumAmountKobo: 1.1 },
    { newCardEnabled: true },
    { currency: 'USD' },
    { availableFloatKobo: 100 },
    { savedMethods: [] },
    { savedMethods: Array(21).fill(capability.savedMethods[0]) },
    { savedMethods: [capability.savedMethods[0], capability.savedMethods[0]] },
  ])
    expect(
      schemas.capability.safeParse({ ...capability, ...change }).success
    ).toBe(false);
  for (const change of [
    { brand: '' },
    { brand: ' ' },
    { brand: 'a'.repeat(65) },
    { brand: '\u0000' },
    { last4: '123' },
    { last4: '12345' },
    { last4: 'abcd' },
    { authorizationCode: 'secret' },
  ])
    expect(
      schemas.capability.safeParse({
        ...capability,
        savedMethods: [{ ...capability.savedMethods[0], ...change }],
      }).success
    ).toBe(false);
  expect(
    schemas.capability.safeParse({
      ...capability,
      enabled: false,
      maximumAmountKobo: 0,
      savedMethods: [],
    }).success
  ).toBe(true);
});
