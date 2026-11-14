import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { piggyvestGoalPinSchemas } from './piggyvest-goal-pin';

const hex = (label: string, length: number) =>
  createHash('sha256').update(label).digest('hex').slice(0, length);
const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const fund = {
  merchantId,
  pin: '1234',
  action: 'fund',
  goalId,
  operationId,
  amountKobo: 2000,
};
const cancel = {
  merchantId,
  pin: '123456',
  action: 'cancel',
  goalId,
  operationId,
};
const complete = {
  merchantId,
  pin: '123456',
  action: 'complete',
  goalId,
  operationId,
};
const { verifyRequest, pinState, verifyResult } = piggyvestGoalPinSchemas;

describe('verifyRequest', () => {
  it('accepts a complete fund request and cancel and complete requests', () => {
    expect(verifyRequest.safeParse(fund).success).toBe(true);
    expect(verifyRequest.safeParse(cancel).success).toBe(true);
    expect(verifyRequest.safeParse(complete).success).toBe(true);
  });

  it.each([
    '123',
    '1234567',
    '12a4',
    '',
    ' 1234',
  ])('rejects the PIN %j', (pin) => {
    expect(verifyRequest.safeParse({ ...fund, pin }).success).toBe(false);
    expect(verifyRequest.safeParse({ ...cancel, pin }).success).toBe(false);
    expect(verifyRequest.safeParse({ ...complete, pin }).success).toBe(false);
  });

  it('accepts the PIN length limits of 4 and 6 digits', () => {
    expect(verifyRequest.safeParse({ ...fund, pin: '0000' }).success).toBe(
      true
    );
    expect(verifyRequest.safeParse({ ...fund, pin: '999999' }).success).toBe(
      true
    );
  });

  it.each([0, -1, 1.5, 10000000000])('rejects the amount %s', (amountKobo) => {
    expect(verifyRequest.safeParse({ ...fund, amountKobo }).success).toBe(
      false
    );
  });

  it('accepts the amount limits of 1 and 9999999999 kobo', () => {
    expect(verifyRequest.safeParse({ ...fund, amountKobo: 1 }).success).toBe(
      true
    );
    expect(
      verifyRequest.safeParse({ ...fund, amountKobo: 9999999999 }).success
    ).toBe(true);
  });

  it('requires the operation and amount for funding', () => {
    const { operationId: _o, ...noOperation } = fund;
    const { amountKobo: _a, ...noAmount } = fund;
    expect(verifyRequest.safeParse(noOperation).success).toBe(false);
    expect(verifyRequest.safeParse(noAmount).success).toBe(false);
  });

  it('requires the server-issued operation id for cancel', () => {
    const { operationId: _o, ...noOperation } = cancel;
    expect(verifyRequest.safeParse(noOperation).success).toBe(false);
    expect(
      verifyRequest.safeParse({ ...cancel, operationId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('requires the server-issued operation id on complete and refuses an invented one', () => {
    const { operationId: _o, ...noOperation } = complete;
    expect(verifyRequest.safeParse(noOperation).success).toBe(false);
    expect(
      verifyRequest.safeParse({ ...complete, operationId: 'not-a-uuid' })
        .success
    ).toBe(false);
  });

  it('refuses an amount on cancel and complete', () => {
    expect(verifyRequest.safeParse({ ...cancel, amountKobo: 1 }).success).toBe(
      false
    );
    expect(
      verifyRequest.safeParse({ ...complete, amountKobo: 1 }).success
    ).toBe(false);
  });

  it('requires a merchant, a goal and a known action, with no extra keys', () => {
    const { merchantId: _m, ...noMerchant } = fund;
    const { goalId: _g, ...noGoal } = cancel;
    expect(verifyRequest.safeParse(noMerchant).success).toBe(false);
    expect(verifyRequest.safeParse(noGoal).success).toBe(false);
    expect(
      verifyRequest.safeParse({ ...cancel, action: 'refund' }).success
    ).toBe(false);
    expect(verifyRequest.safeParse({ ...fund, extra: true }).success).toBe(
      false
    );
    expect(verifyRequest.safeParse({ ...fund, goalId: 'x' }).success).toBe(
      false
    );
  });
});

describe('pinState', () => {
  const set = {
    status: 'set',
    kdfVersion: 1,
    salt: hex('salt', 32),
    attemptsRemaining: 5,
  };

  it('accepts each documented state', () => {
    expect(pinState.safeParse(set).success).toBe(true);
    expect(
      pinState.safeParse({ status: 'locked', lockedUntil: 'later' }).success
    ).toBe(true);
    for (const status of ['unavailable', 'not_set', 'reset_required'])
      expect(pinState.safeParse({ status }).success).toBe(true);
  });

  it('rejects a bad salt, KDF version or attempt count', () => {
    expect(pinState.safeParse({ ...set, salt: hex('salt', 31) }).success).toBe(
      false
    );
    expect(pinState.safeParse({ ...set, salt: 'A'.repeat(32) }).success).toBe(
      false
    );
    expect(pinState.safeParse({ ...set, kdfVersion: 2 }).success).toBe(false);
    expect(pinState.safeParse({ ...set, attemptsRemaining: 6 }).success).toBe(
      false
    );
    expect(pinState.safeParse({ ...set, attemptsRemaining: -1 }).success).toBe(
      false
    );
  });
});

describe('verifyResult', () => {
  it('accepts a verified proof of exactly 64 lowercase hex characters', () => {
    const verified = { status: 'verified', expiresAt: 'soon' };
    expect(
      verifyResult.safeParse({ ...verified, proof: hex('proof', 64) }).success
    ).toBe(true);
    expect(
      verifyResult.safeParse({ ...verified, proof: hex('proof', 63) }).success
    ).toBe(false);
    expect(
      verifyResult.safeParse({
        ...verified,
        proof: hex('proof', 64).toUpperCase(),
      }).success
    ).toBe(false);
    expect(verifyResult.safeParse(verified).success).toBe(false);
  });

  it('accepts the refusal results and rejects unknown ones', () => {
    expect(
      verifyResult.safeParse({ status: 'incorrect', attemptsRemaining: 2 })
        .success
    ).toBe(true);
    expect(
      verifyResult.safeParse({ status: 'incorrect', attemptsRemaining: 9 })
        .success
    ).toBe(false);
    expect(
      verifyResult.safeParse({ status: 'locked', lockedUntil: 'later' }).success
    ).toBe(true);
    for (const status of [
      'unavailable',
      'not_set',
      'reset_required',
      'too_many_proofs',
    ])
      expect(verifyResult.safeParse({ status }).success).toBe(true);
    expect(verifyResult.safeParse({ status: 'consumed' }).success).toBe(false);
  });
});
