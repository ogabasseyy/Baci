import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  cartHandoffRedeemRequestSchema,
  cartInputLineSchema,
  sharedCartMutationRequestSchema,
} from './cart';

const product = '11111111-1111-4111-8111-111111111111';
const offer = '22222222-2222-4222-8222-222222222222';
describe('cart schemas on the installed Zod 4 runtime', () => {
  it('loads and parses refined discriminated-union options', () => {
    expect(z.core.version.major).toBe(4);
    expect(
      sharedCartMutationRequestSchema.parse({
        operationId: 'zod4-add',
        expectedVersion: 1,
        command: {
          type: 'add',
          item: { productId: product, offerId: offer },
          quantity: 1,
        },
      }).command.type
    ).toBe('add');
  });
  it('safeExtend preserves line refinements in the handoff schema', () => {
    expect(typeof cartInputLineSchema.safeExtend).toBe('function');
    const body = {
      attemptId: 'zod4-handoff',
      choice: 'connect',
      handoffId: product,
      token: 'ch1.abc.def',
      lines: [
        {
          sourceLineId: offer,
          item: { productId: product, offerId: offer },
          quantity: 1,
        },
      ],
    };
    expect(cartHandoffRedeemRequestSchema.safeParse(body).success).toBe(true);
    expect(
      cartHandoffRedeemRequestSchema.safeParse({
        ...body,
        lines: [
          {
            ...body.lines[0],
            item: { ...body.lines[0].item, variantId: product },
          },
        ],
      }).success
    ).toBe(false);
  });
});
