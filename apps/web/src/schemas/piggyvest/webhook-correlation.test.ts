import { describe, expect, it } from 'vitest';
import {
  MAX_CORRELATION_FIELD_LENGTH,
  piggyvestWebhookCorrelationSchema,
} from './webhook-correlation';

describe('piggyvestWebhookCorrelationSchema', () => {
  it('accepts both correlation fields', () => {
    expect(
      piggyvestWebhookCorrelationSchema.parse({
        eventId: 'evt-1',
        eventType: 'interest-accrued.success',
      })
    ).toEqual({ eventId: 'evt-1', eventType: 'interest-accrued.success' });
  });

  it('accepts a body that carries neither field', () => {
    expect(piggyvestWebhookCorrelationSchema.parse({})).toEqual({});
  });

  it('accepts a field at exactly the maximum length', () => {
    const value = 'a'.repeat(MAX_CORRELATION_FIELD_LENGTH);
    expect(
      piggyvestWebhookCorrelationSchema.safeParse({ eventId: value }).success
    ).toBe(true);
  });

  it('drops every other key so unrelated payload never reaches triage', () => {
    expect(
      piggyvestWebhookCorrelationSchema.parse({
        eventId: 'evt-1',
        data: { amount: 1000 },
        accountNumber: '0123456789',
      })
    ).toEqual({ eventId: 'evt-1' });
  });

  it.each([
    ['an empty event id', { eventId: '' }],
    ['an empty event type', { eventType: '' }],
    [
      'an over-long event id',
      { eventId: 'a'.repeat(MAX_CORRELATION_FIELD_LENGTH + 1) },
    ],
    [
      'an over-long event type',
      { eventType: 'a'.repeat(MAX_CORRELATION_FIELD_LENGTH + 1) },
    ],
    ['a numeric event id', { eventId: 42 }],
    ['a null event type', { eventType: null }],
  ])('rejects %s', (_name, body) => {
    expect(piggyvestWebhookCorrelationSchema.safeParse(body).success).toBe(
      false
    );
  });

  it('rejects a body that is not an object', () => {
    for (const value of [null, 'evt-1', 7, true]) {
      expect(piggyvestWebhookCorrelationSchema.safeParse(value).success).toBe(
        false
      );
    }
  });
});
