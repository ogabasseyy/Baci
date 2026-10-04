import { describe, expect, it } from 'vitest';
import { piggyvestSavingsLedgerSchema } from './piggyvest-savings-ledger';

const command = {
  operationId: '11111111-1111-4111-8111-111111111111',
  kind: 'credit_principal',
  principalKobo: 100,
  interestKobo: 0,
  evidenceId: 'synthetic-credit-1',
  referenceId: null,
};

describe('internal savings ledger command', () => {
  it('accepts explicit integer kobo without converting units', () => {
    expect(piggyvestSavingsLedgerSchema.parse(command)).toEqual(command);
  });
  it.each([
    0,
    -1,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '100',
  ])('rejects invalid principal %s', (principalKobo) => {
    expect(
      piggyvestSavingsLedgerSchema.safeParse({ ...command, principalKobo })
        .success
    ).toBe(false);
  });
  it('rejects provider payloads and ambiguous interest', () => {
    expect(
      piggyvestSavingsLedgerSchema.safeParse({ ...command, event: 'deposit' })
        .success
    ).toBe(false);
    expect(
      piggyvestSavingsLedgerSchema.safeParse({ ...command, interestKobo: 1 })
        .success
    ).toBe(false);
  });
  it('requires an exact reference for reversal and resolution', () => {
    expect(
      piggyvestSavingsLedgerSchema.safeParse({
        ...command,
        kind: 'reverse_credit',
        principalKobo: 0,
      }).success
    ).toBe(false);
  });
  it('never refunds interest or releases refunds', () => {
    expect(
      piggyvestSavingsLedgerSchema.safeParse({
        ...command,
        kind: 'reserve_refund',
        interestKobo: 1,
      }).success
    ).toBe(false);
    expect(
      piggyvestSavingsLedgerSchema.safeParse({
        ...command,
        kind: 'release_refund',
      }).success
    ).toBe(false);
  });
});
