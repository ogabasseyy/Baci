import { describe, expect, it } from 'vitest';
import {
  type OxygenAttemptRequest,
  type OxygenAvailabilityQuery,
  oxygenAttemptRequestSchema,
  oxygenAvailabilityQuerySchema,
} from './oxygen-requests';

const ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('oxygenAttemptRequestSchema (POST body)', () => {
  it('accepts a valid orderId uuid', () => {
    expect(
      oxygenAttemptRequestSchema.safeParse({ orderId: ORDER_ID }).success
    ).toBe(true);
  });

  it('rejects a missing orderId', () => {
    const parsed = oxygenAttemptRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.orderId).toBeDefined();
    }
  });

  it('rejects a non-uuid orderId', () => {
    const parsed = oxygenAttemptRequestSchema.safeParse({
      orderId: 'not-a-uuid',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.orderId).toBeDefined();
    }
  });

  it('strips unknown keys per the Zod default', () => {
    expect(
      oxygenAttemptRequestSchema.parse({ orderId: ORDER_ID, extra: 'x' })
    ).toEqual({ orderId: ORDER_ID });
  });

  it('exposes the inferred request type', () => {
    const value: OxygenAttemptRequest = { orderId: ORDER_ID };
    expect(oxygenAttemptRequestSchema.safeParse(value).success).toBe(true);
  });
});

describe('oxygenAvailabilityQuerySchema (GET query)', () => {
  it('accepts a valid orderId uuid', () => {
    expect(
      oxygenAvailabilityQuerySchema.safeParse({ orderId: ORDER_ID }).success
    ).toBe(true);
  });

  it('rejects a missing orderId', () => {
    const parsed = oxygenAvailabilityQuerySchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.orderId).toBeDefined();
    }
  });

  it('rejects a non-uuid orderId', () => {
    const parsed = oxygenAvailabilityQuerySchema.safeParse({
      orderId: 'not-a-uuid',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.orderId).toBeDefined();
    }
  });

  it('strips unknown keys per the Zod default', () => {
    expect(
      oxygenAvailabilityQuerySchema.parse({ orderId: ORDER_ID, extra: 'x' })
    ).toEqual({ orderId: ORDER_ID });
  });

  it('exposes the inferred query type', () => {
    const value: OxygenAvailabilityQuery = { orderId: ORDER_ID };
    expect(oxygenAvailabilityQuerySchema.safeParse(value).success).toBe(true);
  });
});
