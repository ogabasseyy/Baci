import { describe, expect, it } from 'vitest';
import { analyticsQuerySchema } from '@/schemas/analytics-query';

describe('analyticsQuerySchema', () => {
  it('accepts a range when both ISO datetimes are provided', () => {
    const result = analyticsQuerySchema.safeParse({
      startDate: '2026-04-01T00:00:00.000Z',
      endDate: '2026-04-10T23:59:59.999Z',
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty query', () => {
    const result = analyticsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('accepts a bounded numeric cache-bust token', () => {
    const result = analyticsQuerySchema.safeParse({ cacheBust: '12' });

    expect(result.success).toBe(true);
  });

  it('rejects non-numeric or oversized cache-bust tokens', () => {
    expect(
      analyticsQuerySchema.safeParse({ cacheBust: 'refresh-now' }).success
    ).toBe(false);
    expect(
      analyticsQuerySchema.safeParse({ cacheBust: '12345678901' }).success
    ).toBe(false);
  });

  it('accepts an optional branch id', () => {
    const result = analyticsQuerySchema.safeParse({
      branchId: '123e4567-e89b-42d3-a456-426614174001',
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed branch ids', () => {
    const result = analyticsQuerySchema.safeParse({
      branchId: 'branch-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['branchId']);
      expect(result.error.issues[0]?.message).toBe('Invalid branch id');
    }
  });

  it('rejects when only one date is provided', () => {
    const result = analyticsQuerySchema.safeParse({
      startDate: '2026-04-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endDate']);
      expect(result.error.issues[0]?.message).toBe(
        'startDate and endDate must be provided together'
      );
    }
  });

  it('rejects when only endDate is provided', () => {
    const result = analyticsQuerySchema.safeParse({
      endDate: '2026-04-10T23:59:59.999Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['startDate']);
      expect(result.error.issues[0]?.message).toBe(
        'startDate and endDate must be provided together'
      );
    }
  });

  it('rejects when startDate is after endDate', () => {
    const result = analyticsQuerySchema.safeParse({
      startDate: '2026-04-10T00:00:00.000Z',
      endDate: '2026-04-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['startDate']);
      expect(result.error.issues[0]?.message).toBe(
        'startDate must be on or before endDate'
      );
    }
  });

  it('rejects malformed ISO datetime strings', () => {
    const result = analyticsQuerySchema.safeParse({
      startDate: '2026-04-01',
      endDate: '2026-04-10T23:59:59.999Z',
    });

    expect(result.success).toBe(false);
  });
});
