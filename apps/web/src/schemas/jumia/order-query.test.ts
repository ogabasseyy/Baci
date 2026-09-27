import { describe, expect, it } from 'vitest';
import { jumiaOrderQuerySchema } from './order-query';

describe('jumiaOrderQuerySchema', () => {
  it('applies bounded pagination defaults', () => {
    expect(jumiaOrderQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it('accepts optional status and integration filters', () => {
    expect(
      jumiaOrderQuerySchema.parse({
        status: 'ready_to_ship',
        integrationId: '00000000-0000-4000-8000-000000000001',
      })
    ).toMatchObject({
      status: 'ready_to_ship',
      integrationId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('rejects pagination outside the provider-safe bounds', () => {
    expect(jumiaOrderQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(jumiaOrderQuerySchema.safeParse({ limit: 1001 }).success).toBe(
      false
    );
    expect(jumiaOrderQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});
