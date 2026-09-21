import { describe, expect, it } from 'vitest';
import {
  parseSantaAction,
  parseSantaActions,
  stripSantaActions,
} from './parse-santa-action';

describe('parseSantaAction', () => {
  it('parses a directive with a plain integer price', () => {
    const result = parseSantaAction(
      'Granted! ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850000'
    );
    expect(result).toEqual({
      type: 'ADD_TO_CART',
      productName: 'iPhone 15',
      price: 850000,
    });
  });

  it('parses a price with thousands separators', () => {
    const result = parseSantaAction(
      'ACTION:ADD_TO_CART|PRODUCT:Samsung Galaxy S24|PRICE:1,200,000'
    );
    expect(result).toEqual({
      type: 'ADD_TO_CART',
      productName: 'Samsung Galaxy S24',
      price: 1200000,
    });
  });

  it('parses a price with decimal places and spaced currency text', () => {
    const result = parseSantaAction(
      'ACTION:ADD_TO_CART|PRODUCT:AirPods Pro|PRICE:350,000.50 NGN'
    );
    expect(result).toEqual({
      type: 'ADD_TO_CART',
      productName: 'AirPods Pro',
      price: 350000.5,
    });
  });

  it('parses a price with lowercase currency text', () => {
    const result = parseSantaAction(
      'ACTION:ADD_TO_CART|PRODUCT:Pixel 9|PRICE:650000 ngn'
    );
    expect(result).toEqual({
      type: 'ADD_TO_CART',
      productName: 'Pixel 9',
      price: 650000,
    });
  });

  it('trims surrounding whitespace from the product name', () => {
    const result = parseSantaAction(
      'ACTION:ADD_TO_CART|PRODUCT:  MacBook Air  |PRICE:999000'
    );
    expect(result?.productName).toBe('MacBook Air');
  });

  it('returns null when there is no directive', () => {
    expect(parseSantaAction('Hello Santa!')).toBeNull();
    expect(parseSantaAction('')).toBeNull();
  });

  it('returns null when the PRICE component is missing', () => {
    expect(
      parseSantaAction('ACTION:ADD_TO_CART|PRODUCT:Samsung Galaxy S24')
    ).toBeNull();
  });

  it('returns null for malformed thousands grouping', () => {
    expect(
      parseSantaAction('ACTION:ADD_TO_CART|PRODUCT:Case|PRICE:12,34')
    ).toBeNull();
  });
});

describe('parseSantaActions', () => {
  it('parses every directive in a response', () => {
    const result = parseSantaActions(
      'ACTION:ADD_TO_CART|PRODUCT:A|PRICE:1000 and ACTION:ADD_TO_CART|PRODUCT:B|PRICE:2,000'
    );

    expect(result).toEqual([
      { type: 'ADD_TO_CART', productName: 'A', price: 1000 },
      { type: 'ADD_TO_CART', productName: 'B', price: 2000 },
    ]);
  });

  it('returns an empty array when directives are missing or malformed', () => {
    expect(parseSantaActions('Just a friendly reply')).toEqual([]);
    expect(parseSantaActions('ACTION:ADD_TO_CART|PRODUCT:Phone')).toEqual([]);
    expect(
      parseSantaActions('ACTION:ADD_TO_CART|PRODUCT:Case|PRICE:12,34')
    ).toEqual([]);
  });

  it('parses a catalog name containing a pipe delimiter', () => {
    expect(
      parseSantaAction(
        'ACTION:ADD_TO_CART|PRODUCT:USB-C | 65W Charger|PRICE:12,000'
      )
    ).toEqual({
      type: 'ADD_TO_CART',
      productName: 'USB-C | 65W Charger',
      price: 12000,
    });
  });

  it('skips a malformed directive before a later valid action', () => {
    expect(
      parseSantaAction(
        'ACTION:ADD_TO_CART|PRODUCT:Broken|PRICE:invalid then ACTION:ADD_TO_CART|PRODUCT:Valid Phone|PRICE:100000'
      )
    ).toEqual({
      type: 'ADD_TO_CART',
      productName: 'Valid Phone',
      price: 100000,
    });
  });
});

describe('stripSantaActions', () => {
  it('removes the directive and trims the remaining message', () => {
    const stripped = stripSantaActions(
      'Your wish is granted! ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850,000'
    );
    expect(stripped).toBe('Your wish is granted!');
  });

  it('removes every directive when more than one is present', () => {
    const stripped = stripSantaActions(
      'ACTION:ADD_TO_CART|PRODUCT:A|PRICE:1000 and ACTION:ADD_TO_CART|PRODUCT:B|PRICE:2000'
    );
    expect(stripped).toBe('and');
  });

  it('removes trailing price punctuation and currency text', () => {
    const stripped = stripSantaActions(
      'Granted ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850000NGN. Enjoy it.'
    );
    expect(stripped).toBe('Granted Enjoy it.');
  });

  it('removes directives with decimal prices and lowercase spaced currency text', () => {
    const stripped = stripSantaActions(
      'Granted ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850000.00 ngn. Enjoy it.'
    );
    expect(stripped).toBe('Granted Enjoy it.');
  });

  it('removes directives with decimal prices and uppercase spaced currency text', () => {
    const stripped = stripSantaActions(
      'Granted ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850000.00 NGN. Enjoy it.'
    );
    expect(stripped).toBe('Granted Enjoy it.');
  });

  it('preserves attached prose after a directive when Santa omits a space', () => {
    const stripped = stripSantaActions(
      'Granted ACTION:ADD_TO_CART|PRODUCT:iPhone 15|PRICE:850000.Enjoy it.'
    );
    expect(stripped).toBe('Granted Enjoy it.');
  });

  it('leaves text without a directive unchanged', () => {
    expect(stripSantaActions('Just a friendly reply')).toBe(
      'Just a friendly reply'
    );
  });
});
