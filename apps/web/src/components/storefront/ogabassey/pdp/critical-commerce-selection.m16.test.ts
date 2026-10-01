import { describe, expect, it } from 'vitest';
import { getVariantAxesWithMultipleOptions } from './critical-commerce-selection';

describe('critical commerce selection M16 R2 axes', () => {
  it('requires only real M16 R2 purchase axes and normalizes equivalent specs', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: {
            camera: 'Webcam',
            graphics: '8GB RTX 4070 Graphics',
            model_number: 'DYMSR54',
            operating_system: 'Windows 11 Pro',
            processor: 'Intel Ultra 7 155H',
            ram: '16GB RAM',
            storage: '1TB SSD',
          },
          condition: 'used',
          id: 'm16-used',
          merchant_id: 'merchant-1',
          product_id: 'alienware-m16-r2',
          stock_quantity: 0,
        },
        {
          attributes: {
            camera: 'Webcam',
            graphics: '8GB NVIDIA GeForce RTX 4070 Graphics',
            model_number: 'DYMSR54',
            operating_system: 'Windows 11 Pro',
            processor: 'Intel Core Ultra 9 185H',
            ram: '64GB RAM',
            storage: '1TB SSD',
          },
          condition: 'new',
          id: 'm16-new',
          merchant_id: 'merchant-1',
          product_id: 'alienware-m16-r2',
          stock_quantity: 0,
        },
      ])
    ).toEqual(['condition', 'processor', 'ram']);
  });

});
