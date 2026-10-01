import { describe, expect, it } from 'vitest';
import { getRenderableVariantAxes } from './variant-attributes';

describe('storefront laptop metadata axes', () => {
  it('does not expose descriptive laptop specifications as variant axes', () => {
    expect(
      getRenderableVariantAxes(
        [
          {
            attributes: {
              camera: 'Webcam',
              keyboard: 'Backlit keyboard',
              model_number: 'DYMSR54',
              operating_system: 'Windows 11 Pro',
              processor: 'Intel Ultra 7 155H',
              ram: '16GB RAM',
              storage: '1TB SSD',
            },
            condition: 'used',
          },
          {
            attributes: {
              camera: 'Webcam',
              keyboard: 'Backlit keyboard',
              model_number: 'DYMSR54',
              operating_system: 'Windows 11 Pro',
              processor: 'Intel Core Ultra 9 185H',
              ram: '64GB RAM',
              storage: '1TB SSD',
            },
            condition: 'new',
          },
        ],
        {
          camera: ['Webcam'],
          condition: ['used', 'new'],
          model_number: ['DYMSR54'],
          processor: ['Intel Ultra 7 155H', 'Intel Core Ultra 9 185H'],
          ram: ['16GB RAM', '64GB RAM'],
          storage: ['1TB SSD'],
        }
      )
    ).toEqual(['condition', 'ram', 'processor']);
  });
});
