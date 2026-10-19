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

  it('rejects sourceLineId on ordinary replacement lines', () => {
    const issue = validateCartCommand({
      lines: [
        {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          quantity: 1,
          sourceLineId: 'line-9',
        },
      ],
      type: 'replace',
    });
    expect(issue?.code).toBe('invalid_item');
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
          negotiatedUnitPriceMinor: -1,
          quantity: 1,
        },
      ],
      type: 'replace',
    });
    expect(badPrice?.code).toBe('invalid_item');
  });
});

describe('cart command validation boundaries', () => {
  const item = { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

  it.each([
    -1,
    0,
    0.5,
    11,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid quantity %s across add, set_quantity, and replacement', (quantity) => {
    expect(validateCartCommand({ type: 'add', item, quantity })?.code).toBe(
      'invalid_item'
    );
    expect(
      validateCartCommand({ type: 'set_quantity', lineId: 'line-1', quantity })
        ?.code
    ).toBe('invalid_item');
    expect(
      validateCartCommand({ type: 'replace', lines: [{ item, quantity }] })
        ?.code
    ).toBe('invalid_item');
  });

  it('validates negotiated price commands', () => {
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: 'line-1',
        negotiatedUnitPriceMinor: 7500,
      })
    ).toBeNull();
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: 'line-1',
        negotiatedUnitPriceMinor: null,
      })
    ).toBeNull();
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: ' ',
        negotiatedUnitPriceMinor: 7500,
      })?.code
    ).toBe('invalid_item');
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: 'line-1',
        negotiatedUnitPriceMinor: 0,
      })
    ).toBeNull();
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: 'line-1',
        negotiatedUnitPriceMinor: -1,
      })?.code
    ).toBe('invalid_item');
    expect(
      validateCartCommand({
        type: 'set_negotiated_price',
        lineId: 'line-1',
        negotiatedUnitPriceMinor: 75.5,
      })?.code
    ).toBe('invalid_item');
  });

  it.each([1, 10])('accepts quantity boundary %s', (quantity) => {
    expect(validateCartCommand({ type: 'add', item, quantity })).toBeNull();
    expect(
      validateCartCommand({ type: 'set_quantity', lineId: 'line-1', quantity })
    ).toBeNull();
  });

  it('accepts twenty valid replacement lines and rejects twenty-one', () => {
    const lines = Array.from({ length: 21 }, (_, index) => ({
      item: {
        productId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      },
      quantity: 1,
    }));
    expect(
      validateCartCommand({ type: 'replace', lines: lines.slice(0, 20) })
    ).toBeNull();
    expect(validateCartCommand({ type: 'replace', lines })?.code).toBe(
      'invalid_item'
    );
  });

  it('checks later lines rather than accepting a valid first line alone', () => {
    expect(
      validateCartCommand({
        type: 'replace',
        lines: [
          { item, quantity: 1 },
          { item, quantity: 0 },
        ],
      })?.code
    ).toBe('invalid_item');
  });

  it('allows different variants of the same product', () => {
    expect(
      validateCartCommand({
        type: 'replace',
        lines: [
          {
            item: {
              ...item,
              variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            },
            quantity: 1,
          },
          {
            item: {
              ...item,
              variantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            },
            quantity: 1,
          },
        ],
      })
    ).toBeNull();
  });
});
