import { describe, expect, it } from 'vitest';
import { prefundedCardRuntimeSchemas as schema } from './prefunded-card-runtime';

describe('prefunded runtime acknowledgements', () => {
  it.each([
    '',
    'https://host',
    '1.5',
    '-1',
    '123456789012345678901',
  ])('refuses malformed physical identity %s', (value) => {
    expect(schema.systemIdentifier.safeParse(value).success).toBe(false);
  });
  it('accepts only an explicit durable projection result', () => {
    expect(
      schema.projectionRows.safeParse([{ result: 'applied' }]).success
    ).toBe(true);
    expect(
      schema.projectionRows.safeParse([{ result: 'success' }]).success
    ).toBe(false);
    expect(schema.projectionRows.safeParse([]).success).toBe(false);
  });
  it('rejects unsafe fences and incomplete persisted state', () => {
    const state = {
      operationId: '10000000-0000-4000-8000-000000000001',
      collectionStatus: 'not_started',
      transferStatus: 'not_started',
      projectionStatus: 'unapplied',
      collectionFence: 0,
      transferFence: 0,
    };
    expect(schema.readRows.safeParse([{ result: state }]).success).toBe(true);
    expect(
      schema.readRows.safeParse([
        { result: { ...state, collectionFence: Number.MAX_SAFE_INTEGER + 1 } },
      ]).success
    ).toBe(false);
    expect(schema.readRows.safeParse([{ result: {} }]).success).toBe(false);
  });
});
