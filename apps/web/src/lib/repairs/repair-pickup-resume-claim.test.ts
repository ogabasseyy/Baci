import { describe, expect, it } from 'vitest';
import { repairPickupResumeClaims } from './repair-pickup-resume-claim';

const secret = 'resume-secret-for-tests';
const claim = {
  customerEmail: 'Ada@Example.com',
  issuedAt: Date.now(),
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  repairId: '223e4567-e89b-12d3-a456-426614174000',
};

describe('repairPickupResumeClaims', () => {
  it('round-trips a signed resume capability', () => {
    const token = repairPickupResumeClaims.create(claim, secret);
    expect(repairPickupResumeClaims.verify(token, secret)).toEqual({
      ...claim,
      customerEmail: 'ada@example.com',
    });
  });

  it('rejects forged or expired resume tokens', () => {
    const token = repairPickupResumeClaims.create(claim, secret);
    expect(repairPickupResumeClaims.verify(`${token}a`, secret)).toBeNull();
    expect(repairPickupResumeClaims.verify(token, 'other-secret')).toBeNull();
    expect(
      repairPickupResumeClaims.verify(
        repairPickupResumeClaims.create(
          { ...claim, issuedAt: Date.now() - 3 * 60 * 60 * 1000 },
          secret
        ),
        secret
      )
    ).toBeNull();
  });
});
