import { expect, it } from 'vitest';
import {
  engineCommand,
  publicCartSnapshot,
  publicCommand,
} from './shared-cart-command-mapping';

it('projects public prices and identities without voucher, account or negotiation credentials', () => {
  const result = publicCartSnapshot({
    version: 2,
    currency: 'NGN',
    totalMinor: 15000,
    ownerAccountId: 'private',
    lines: [
      {
        id: 'line',
        item: { productId: 'p', variantId: 'v', voucherToken: 'private' },
        quantity: 1,
        unitPriceMinor: 15000,
        negotiationToken: 'private',
      },
    ],
  } as never);
  expect(result).toEqual({
    version: 2,
    currency: 'NGN',
    total: 150,
    lines: [
      {
        lineId: 'line',
        productId: 'p',
        variantId: 'v',
        quantity: 1,
        price: 150,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('private');
});
it('retains original public variant/condition/options and does not map private engine actions for replay', () => {
  const command = {
    kind: 'add' as const,
    productId: 'p',
    variantId: 'v',
    condition: 'refurbished',
    options: { Color: 'Blue' },
    quantity: 2,
  };
  expect(publicCommand(engineCommand(command))).toEqual(command);
  expect(publicCommand({ type: 'clear' })).toBeNull();
});
