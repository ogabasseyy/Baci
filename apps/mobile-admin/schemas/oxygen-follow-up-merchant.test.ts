import { describe, expect, it } from 'vitest';
import { oxygenFollowUpMerchantSchema } from './oxygen-follow-up-merchant';

const id = '20000000-0000-4000-8000-000000000001';

describe('oxygenFollowUpMerchantSchema', () => {
  it('requires a valid merchant UUID', () => {
    expect(oxygenFollowUpMerchantSchema.safeParse(id).success).toBe(true);
    expect(oxygenFollowUpMerchantSchema.safeParse('not-a-uuid').success).toBe(
      false
    );
  });
});
