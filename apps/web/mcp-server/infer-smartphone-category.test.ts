import { describe, expect, it } from 'vitest';
import { inferSmartphoneCategory } from './infer-smartphone-category';

describe('inferSmartphoneCategory', () => {
  it('infers phones without reclassifying accessory or mixed-device searches', () => {
    expect(inferSmartphoneCategory('Redmi phones', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('phone under 300000', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('Redmi phone 128GB', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('iPhone 15', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('iPhone 15 Pro Max 256GB', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('iPhone 15 under ₦500,000', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('phone 5G', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('iPhone 15 4G', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('looking for iPhone 15', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('show me an iPhone 15', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('find me a phone', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('I want an iPhone', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('looking for Redmi phones', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('Samsung Galaxy phone', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('cheap Redmi phone', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('looking for Redmi phone case', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('battery iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('earphones iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('iPhone 15 5G 128GB', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('iPhone 15 128GB 5G under ₦500,000', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('looking for iPhone 15 case', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('phone 5G case', undefined)).toBeUndefined();
    for (const accessoryQuery of ['iPhone 15 stand', 'iPhone 15 holder', 'iPhone 15 lens', 'iPhone 15 pouch', 'iPhone 15 wallet', 'iPhone 15 earbuds']) {
      expect(inferSmartphoneCategory(accessoryQuery, undefined)).toBeUndefined();
    }
    expect(inferSmartphoneCategory('phone stand', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('smartphone mount', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('phones and tablets', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('case for iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('find me a case for iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('charger for phone', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('case iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('charger phone', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('screen protector iPhone 15', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('tablets and phones', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('tablets, phone', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('laptop, phone', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('Redmi phones', 'Accessories')).toBeUndefined();
  });

  it('recognizes lettered iPhone models', () => {
    for (const model of ['iPhone SE', 'iPhone XR', 'iPhone XS']) {
      expect(inferSmartphoneCategory(model, undefined)).toBe('Smartphones');
    }
  });
});
