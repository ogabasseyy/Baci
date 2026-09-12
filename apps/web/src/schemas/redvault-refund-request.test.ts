import { describe, expect, it } from 'vitest';
import { redvaultRefundRequestSchema } from './redvault-refund-request';

const base = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'ops-return-1',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
};

describe('REDVAULT refund request schema', () => {
  it('accepts a merchandise return only with stable persisted unit identities', () => {
    expect(
      redvaultRefundRequestSchema.safeParse({
        ...base,
        type: 'merchandise_units',
        units: [
          {
            orderItemId: '22222222-2222-4222-8222-222222222222',
            unitOrdinal: 1,
          },
        ],
      }).success
    ).toBe(true);
  });

  it('accepts a full capture refund without merchandise units', () => {
    expect(
      redvaultRefundRequestSchema.safeParse({
        ...base,
        type: 'full_capture',
      }).success
    ).toBe(true);
  });

  it.each([
    { ...base, type: 'full_capture', units: [] },
    { ...base, type: 'merchandise_units' },
    { ...base, type: 'merchandise_units', units: [] },
    {
      ...base,
      type: 'merchandise_units',
      units: [{ orderItemId: 'bad', unitOrdinal: 0 }],
    },
  ])('rejects unsupported or unbound refund input', (value) => {
    expect(redvaultRefundRequestSchema.safeParse(value).success).toBe(false);
  });

  it('rejects an unsafe persisted unit ordinal', () => {
    expect(
      redvaultRefundRequestSchema.safeParse({
        ...base,
        type: 'merchandise_units',
        units: [
          {
            orderItemId: '22222222-2222-4222-8222-222222222222',
            unitOrdinal: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      }).success
    ).toBe(false);
  });
});
