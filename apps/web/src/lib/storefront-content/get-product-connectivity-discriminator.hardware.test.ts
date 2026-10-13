import { describe, expect, it } from 'vitest';
import { getProductConnectivityDiscriminators } from './get-product-connectivity-discriminator';

describe('getProductConnectivityDiscriminators hardware variants', () => {
  it('retains power-bank battery capacity as a PDP variant', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['Xiaomi 10000mAh Power Bank'],
        [],
        'accessories'
      )
    ).toEqual(['10000mah']);
  });

  it('retains charger wattage as a PDP variant', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['Apple 20W USB-C Power Adapter'],
        [],
        'accessories'
      )
    ).toEqual(['20w']);
  });

  it('retains every laptop hardware tier from a combined configuration', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['ASUS ROG G16 Core i7 RTX 4060'],
        [],
        'gaming-laptops'
      )
    ).toEqual(['corei7', 'rtx4060']);
  });

  it('retains explicit laptop RAM alongside storage', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['Lenovo ThinkPad T14 8GB RAM 512GB'],
        [],
        'laptops'
      )
    ).toEqual(['8gb', '512gb']);
  });

  it('retains compact decimal dimensions as one PDP discriminator', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['Apple iPad Pro 12.9inch'],
        [],
        'tablets'
      )
    ).toEqual(['12.9inch']);
  });
});
