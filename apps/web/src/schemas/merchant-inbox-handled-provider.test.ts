import { describe, expect, it } from 'vitest';
import { providerHandledCountSchema } from './merchant-inbox-handled-provider';

describe('providerHandledCountSchema', () => {
  it('reads the total from a filtered conversation list', () => {
    const parsed = providerHandledCountSchema.parse({
      meta: { all_count: 12, extra: true },
      payload: [],
    });
    expect(parsed.meta.all_count).toBe(12);
  });

  it('accepts zero', () => {
    expect(
      providerHandledCountSchema.safeParse({ meta: { all_count: 0 } }).success
    ).toBe(true);
  });

  it.each([
    { meta: { all_count: -1 } },
    { meta: { all_count: 1.5 } },
    { meta: { all_count: '3' } },
    { meta: { all_count: Number.MAX_SAFE_INTEGER + 1 } },
    { meta: {} },
    {},
  ])('rejects %j', (value) => {
    expect(providerHandledCountSchema.safeParse(value).success).toBe(false);
  });
});
