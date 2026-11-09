import { describe, expect, it } from 'vitest';
import {
  isCellularPhoneProduct,
  isPhoneLikeProduct,
} from './cellular-phone-classification';

describe('cellular-phone-classification', () => {
  it('classifies phones by model name', () => {
    expect(isCellularPhoneProduct({ name: 'iPhone 16 Pro Max' })).toBe(true);
    expect(isCellularPhoneProduct({ name: 'Google Pixel 8' })).toBe(true);
    expect(isCellularPhoneProduct({ name: 'Samsung Galaxy S24' })).toBe(true);
    expect(isCellularPhoneProduct({ name: 'Samsung Galaxy A05s' })).toBe(true);
  });

  it('classifies phones by category and category slug', () => {
    expect(
      isCellularPhoneProduct({ name: 'Unknown Phone', category: 'Smartphones' })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Retro Handset',
        category_slug: 'feature-phones',
      })
    ).toBe(true);
  });

  it('classifies phones with null category and joined product_categories', () => {
    const product = {
      name: 'Unbranded Flagship Device',
      category: null,
      product_categories: [
        { categories: { name: 'Smartphones', slug: 'smartphones' } },
      ],
    };
    expect(isCellularPhoneProduct(product)).toBe(true);
    expect(isPhoneLikeProduct(product)).toBe(true);
  });

  it('preserves handset classification in mixed product categories', () => {
    expect(
      isCellularPhoneProduct({
        name: 'Samsung Galaxy S24',
        category: 'Mobile Phones & Accessories',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Samsung Galaxy S24',
        category: 'Phones & Tablets',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'iPhone 15',
        category: 'Phones & Tablets',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Google Pixel 8',
        category: 'Mobile Phones & Accessories',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Motorola Edge 50',
        category: 'Phones & Tablets',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Tecno Camon 30',
        category: 'Mobile Phones & Accessories',
      })
    ).toBe(true);
  });

  it('excludes replacement parts and batteries even with phone branding', () => {
    expect(
      isCellularPhoneProduct({
        name: 'iPhone 15 Replacement Battery',
        category: 'Accessories',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Samsung Galaxy S24 Battery Replacement',
        category: 'Mobile Phones & Accessories',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Google Pixel 8 Spare Parts Screen',
        category: 'Smartphones',
      })
    ).toBe(false);
  });

  it('excludes phone accessories and cases', () => {
    expect(
      isCellularPhoneProduct({
        name: 'iPhone 15 Pro Case',
        category: 'Phone Accessories',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Galaxy S24 Screen Protector',
        category: 'Accessories',
      })
    ).toBe(false);
  });

  it('excludes accessories and genuine tablets even in mixed product categories', () => {
    expect(
      isCellularPhoneProduct({
        name: 'iPhone 15 Silicone Case',
        category: 'Mobile Phones & Accessories',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Galaxy Tab S9',
        category: 'Phones & Tablets',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Apple iPad Pro 11-inch',
        category: 'Phones & Tablets',
      })
    ).toBe(false);
  });

  it('excludes tablets and computers', () => {
    expect(
      isCellularPhoneProduct({
        name: 'iPad Pro',
        category: 'Tablets',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'MacBook Air',
        category: 'Laptops',
      })
    ).toBe(false);
  });

  it('excludes tablets such as Nokia T-series and Tecno Megapad with or without category', () => {
    expect(
      isCellularPhoneProduct({
        name: 'Nokia T21',
        category: 'Tablets',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Nokia T10 3GB 32GB',
        category: 'Tablets',
      })
    ).toBe(false);
    expect(
      isCellularPhoneProduct({
        name: 'Tecno Megapad 10 4GB 128GB',
        category: 'Tablets',
      })
    ).toBe(false);

    expect(isCellularPhoneProduct({ name: 'Nokia T21' })).toBe(false);
    expect(isCellularPhoneProduct({ name: 'Nokia T10 3GB 32GB' })).toBe(false);
    expect(isCellularPhoneProduct({ name: 'Tecno Megapad 10 4GB 128GB' })).toBe(
      false
    );
    expect(
      isCellularPhoneProduct({
        name: 'OnePlus Pad 2',
        category: 'Phones & Tablets',
      })
    ).toBe(false);
    expect(isCellularPhoneProduct({ name: 'OnePlus Pad' })).toBe(false);
  });

  it('preserves phone classification in mixed categories like Tablets & Phones', () => {
    expect(
      isCellularPhoneProduct({
        name: 'Samsung Galaxy S24',
        category: 'Tablets & Phones',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'iPhone 15',
        category: 'Tablets & Phones',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Tecno Camon 30',
        category: 'Tablets & Phones',
      })
    ).toBe(true);
    expect(
      isCellularPhoneProduct({
        name: 'Motorola Edge 50',
        category: 'Tablets & Phones',
      })
    ).toBe(true);
  });
});
