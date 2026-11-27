import { expect, it } from 'vitest';
import { partialRefundCliArgsSchema } from './bank-offer-partial-refund-cli-args';

const id = 'a0000000-0000-4000-8000-000000000001';

it('requires two UUIDs and a manifest path', () => {
  expect(
    partialRefundCliArgsSchema.safeParse([id, id, '/tmp/return.json']).success
  ).toBe(true);
  expect(
    partialRefundCliArgsSchema.safeParse(['bad', id, '/tmp/return.json'])
      .success
  ).toBe(false);
  expect(partialRefundCliArgsSchema.safeParse([id, id, '']).success).toBe(
    false
  );
});
