import { describe, expect, it } from 'vitest';
import { buildCriticalInitialVariantIntent } from './critical-commerce-initial-intent';

describe('buildCriticalInitialVariantIntent', () => {
  it('keeps selectable URL intent while excluding descriptive specifications', () => {
    expect(
      buildCriticalInitialVariantIntent({
        attributes: {
          camera: 'Webcam',
          condition: 'UK Used',
          keyboard: 'Backlit keyboard',
          processor: 'Intel Ultra 7 155H',
          ram: '16GB RAM',
        },
        requiredAxes: ['condition', 'processor', 'ram'],
      })
    ).toEqual({
      explicitCondition: 'used',
      explicitSelectedAxes: ['condition', 'processor', 'ram'],
      resolverAttributes: {
        processor: 'Intel Core Ultra 7 155H',
        ram: '16GB',
      },
      selectedAttributes: {
        condition: 'used',
        processor: 'Intel Core Ultra 7 155H',
        ram: '16GB',
      },
    });
  });

  it('preserves an explicit top-level condition when attributes omit it', () => {
    expect(
      buildCriticalInitialVariantIntent({
        attributes: { ram: '64GB RAM' },
        condition: 'new',
        requiredAxes: ['condition', 'ram'],
      })
    ).toMatchObject({
      explicitCondition: 'new',
      explicitSelectedAxes: ['ram', 'condition'],
      resolverAttributes: { ram: '64GB' },
      selectedAttributes: { condition: 'new', ram: '64GB' },
    });
  });
});
