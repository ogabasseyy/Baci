import { describe, expect, it } from 'vitest';
import { searchAssistanceRequestSchema } from './search-assistance';

const valid = {
  requestId: '019c6e27-e55b-73d1-87d8-4e01f1f75043',
  query: 'used iphone under 500k',
};

describe('searchAssistanceRequestSchema', () => {
  it('accepts a well-formed assistance request', () => {
    expect(searchAssistanceRequestSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects short queries, bad ids, and extra actions', () => {
    expect(
      searchAssistanceRequestSchema.safeParse({ ...valid, query: 'x' }).success
    ).toBe(false);
    expect(
      searchAssistanceRequestSchema.safeParse({
        ...valid,
        requestId: 'not-a-uuid',
      }).success
    ).toBe(false);
    expect(
      searchAssistanceRequestSchema.safeParse({ ...valid, action: 'checkout' })
        .success
    ).toBe(false);
  });
});
