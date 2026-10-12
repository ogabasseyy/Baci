import { describe, expect, it } from 'vitest';
import { validateCartCommand } from './commands';

describe('validateCartCommand', () => {
  it('accepts a well-formed add command', () => {
    expect(
      validateCartCommand({
        item: { productId: '11111111-1111-4111-8111-111111111111' },
        quantity: 2,
        type: 'add',
      })
    ).toBeNull();
  });

  it('rejects an add with a zero quantity', () => {
    const issue = validateCartCommand({
      item: { productId: '11111111-1111-4111-8111-111111111111' },
      quantity: 0,
      type: 'add',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects an add above the per-line quantity limit', () => {
    const issue = validateCartCommand({
      item: { productId: '11111111-1111-4111-8111-111111111111' },
      quantity: 11,
      type: 'add',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects an add without a product', () => {
    const issue = validateCartCommand({
      item: { productId: '' },
      quantity: 1,
      type: 'add',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects set_quantity without a line id', () => {
    const issue = validateCartCommand({
      lineId: '',
      quantity: 1,
      type: 'set_quantity',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects set_quantity with a zero quantity', () => {
    const issue = validateCartCommand({
      lineId: 'line-1',
      quantity: 0,
      type: 'set_quantity',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects remove without a line id', () => {
    const issue = validateCartCommand({
      lineId: '',
      type: 'remove',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('accepts clear', () => {
    expect(validateCartCommand({ type: 'clear' })).toBeNull();
  });

  it('rejects a replacement above the line limit', () => {
    const lines = Array.from({ length: 21 }, (_, index) => ({
      item: { productId: `product-${index}` },
      quantity: 1,
    }));

    const issue = validateCartCommand({ lines, type: 'replace' });

    expect(issue?.code).toBe('invalid_item');
  });

  it('rejects a replacement containing an invalid line', () => {
    const issue = validateCartCommand({
      lines: [{ item: { productId: '' }, quantity: 1 }],
      type: 'replace',
    });

    expect(issue?.code).toBe('invalid_item');
  });

  it('accepts voucher and negotiation attachments on add and replace', () => {
    const attachments = {
      negotiatedUnitPriceMinor: 2000,
      negotiationStatus: 'accepted' as const,
      voucherAwardId: 'award-1',
      voucherToken: 'token-1',
    };

    expect(
      validateCartCommand({
        item: { productId: '11111111-1111-4111-8111-111111111111' },
        quantity: 1,
        type: 'add',
        ...attachments,
      })
    ).toBeNull();
    expect(
      validateCartCommand({
        lines: [
          {
            item: { productId: '11111111-1111-4111-8111-111111111111' },
            quantity: 1,
            ...attachments,
          },
        ],
        type: 'replace',
      })
    ).toBeNull();
  });

  it('rejects blank vouchers and non-positive negotiated prices', () => {
    const blank = validateCartCommand({
      item: { productId: '11111111-1111-4111-8111-111111111111' },
      quantity: 1,
      type: 'add',
      voucherToken: '  ',
    });
    expect(blank?.code).toBe('invalid_item');

    const badPrice = validateCartCommand({
      lines: [
        {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          negotiatedUnitPriceMinor: 0,
          quantity: 1,
        },
      ],
      type: 'replace',
    });
    expect(badPrice?.code).toBe('invalid_item');
  });
});
