import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('getDurableProductSeoText gift-card identity', () => {
  it.each([
    [
      'PSN Gift Card £50 GBP',
      'PSN Gift Card £50 GBP: £50 value for a UK account',
    ],
    [
      'Amazon Gift Card 50 USD',
      'Use this 50 USD gift card for Amazon purchases',
    ],
    [
      'Amazon Gift Card 50 USD',
      'Use this USD 50 gift card for Amazon purchases',
    ],
    [
      'PSN Gift Card £50 GBP',
      '£50 PSN gift card for a UK PlayStation account.',
    ],
    [
      'Amazon Gift Card 50 USD',
      '50 USD Amazon gift card for an American account.',
    ],
    ['PSN Gift Card £50 GBP', 'Buy £50 PSN gift card for a UK account.'],
    ['Amazon Gift Card 50 USD', 'USD 50.00 Amazon gift card'],
    [
      'Amazon Gift Card 50 USD',
      'Use this $50 USD gift card for American purchases',
    ],
  ])('preserves face-value forms for %s', (name, text) => {
    const args = { product: { name } };
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text}. Buy for USD 80.` })
    ).toBe('');
    expect(
      getDurableProductSeoText({ ...args, text: `${text}. Buy for USD 50.` })
    ).toBe('');
  });

  it('preserves matching denomination when the gift-card label precedes the amount', () => {
    const text = 'This gift card is worth £50 for Amazon purchases';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Amazon Gift Card £50' },
      })
    ).toBe(text);
  });

  it('does not exempt a same-value retail price merely because a gift-card label follows', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy for USD 50 Amazon gift card credit.',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('does not confuse different dollar currencies with the same face value', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this 50 CAD gift card for Canadian purchases',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('uses an explicit ISO code rather than an ambiguous dollar symbol for gift-card identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this $50 CAD gift card for Canadian purchases',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('rejects a mismatched explicit code when the product denomination also has a dollar qualifier', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this $50 USD gift card for purchases',
        product: { name: 'Amazon Gift Card $50 CAD' },
      })
    ).toBe('');
  });

  it.each([
    'Use this CAD $50 gift card for Canadian purchases',
    'Buy for just USD 50 Amazon gift card credit.',
    'Priced at just USD 50 Amazon gift card credit.',
  ])('keeps explicit currency/retail relations above denomination identity: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('preserves a denomination in the product name but rejects a separate retail price', () => {
    const text = 'PSN Gift Card £50 GBP Price in Nigeria';
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
    };
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} from ₦80,000` })
    ).toBe('');
  });

  it('preserves a repeated gift-card face value but not a quoted retail price', () => {
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
    };
    const text =
      'PSN Gift Card £50 GBP at Ogabassey: £50 GBP value for PlayStation Store.';
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} Buy from ₦80,000.` })
    ).toBe('');
  });
});
