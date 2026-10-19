import { describe, expect, it } from 'vitest';
import { getDeliveryEstimate } from './product-delivery-estimate';

describe('getDeliveryEstimate', () => {
  it('returns a placeholder before the delivery date is initialized', () => {
    expect(getDeliveryEstimate('Lagos')).toBe('Available shortly');
  });

  const FIXED_DATE = new Date('2024-01-10T12:00:00Z');

  it('returns a 1–2 day window for Lagos', () => {
    const plus1 = new Date(FIXED_DATE);
    plus1.setDate(FIXED_DATE.getDate() + 1);
    const plus2 = new Date(FIXED_DATE);
    plus2.setDate(FIXED_DATE.getDate() + 2);

    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(d);
    const expected = `${fmt(plus1)} - ${fmt(plus2)}`;

    const result = getDeliveryEstimate('Lagos', FIXED_DATE);

    expect(result).toBe(expected);
  });

  it('returns a 3–5 day window for Outside Lagos', () => {
    const plus3 = new Date(FIXED_DATE);
    plus3.setDate(FIXED_DATE.getDate() + 3);
    const plus5 = new Date(FIXED_DATE);
    plus5.setDate(FIXED_DATE.getDate() + 5);

    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(d);
    const expected = `${fmt(plus3)} - ${fmt(plus5)}`;

    const result = getDeliveryEstimate('Outside Lagos', FIXED_DATE);

    expect(result).toBe(expected);
  });

  it('rolls month boundaries correctly for Lagos delivery windows', () => {
    const boundaryDate = new Date('2024-01-31T12:00:00Z');
    const plus1 = new Date(boundaryDate);
    plus1.setDate(boundaryDate.getDate() + 1);
    const plus2 = new Date(boundaryDate);
    plus2.setDate(boundaryDate.getDate() + 2);

    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(d);
    const expected = `${fmt(plus1)} - ${fmt(plus2)}`;

    const result = getDeliveryEstimate('Lagos', boundaryDate);

    expect(result).toBe(expected);
  });

  it('rolls month boundaries correctly for Outside Lagos delivery windows', () => {
    const boundaryDate = new Date('2024-01-31T12:00:00Z');
    const plus3 = new Date(boundaryDate);
    plus3.setDate(boundaryDate.getDate() + 3);
    const plus5 = new Date(boundaryDate);
    plus5.setDate(boundaryDate.getDate() + 5);

    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(d);
    const expected = `${fmt(plus3)} - ${fmt(plus5)}`;

    const result = getDeliveryEstimate('Outside Lagos', boundaryDate);

    expect(result).toBe(expected);
  });
});
