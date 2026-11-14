import { expect, it } from '@jest/globals';
import { planWalletSavingsRail } from './wallet-savings-rail';

const plan = (
  hasStoredId: boolean,
  isPrimary: boolean,
  storedRail: 'primary' | 'legacy' | null
) => planWalletSavingsRail({ hasStoredId, isPrimary, storedRail });

it('starts a fresh id on the rail the customer is on now', () => {
  expect(plan(false, true, null)).toEqual({ kind: 'submit', rail: 'primary' });
  expect(plan(false, false, null)).toEqual({ kind: 'submit', rail: 'legacy' });
});

it('keeps a stored legacy id on legacy even after the merchant becomes primary', () => {
  expect(plan(true, true, 'legacy')).toEqual({
    kind: 'submit',
    rail: 'legacy',
  });
  expect(plan(true, false, 'legacy')).toEqual({
    kind: 'submit',
    rail: 'legacy',
  });
});

it('checks a stored primary id on primary and blocks it once the merchant is not primary', () => {
  expect(plan(true, true, 'primary')).toEqual({ kind: 'check-primary' });
  expect(plan(true, false, 'primary')).toEqual({ kind: 'blocked' });
});

it('treats an unrecorded id as before the rail was stored', () => {
  expect(plan(true, true, null)).toEqual({ kind: 'check-primary' });
  expect(plan(true, false, null)).toEqual({ kind: 'submit', rail: 'legacy' });
});
