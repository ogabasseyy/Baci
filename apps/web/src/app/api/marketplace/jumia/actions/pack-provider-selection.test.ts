import { describe, expect, it } from 'vitest';
import { resolvePackProviders } from './pack-provider-selection';

describe('resolvePackProviders', () => {
  it('reports a discovered provider requiring tracking code', () => {
    const result = resolvePackProviders(
      ['ITEM-1'],
      [
        {
          id: 'ITEM-1',
          shipmentProviders: [{ id: 'SP-1', trackingCodeRequired: true }],
        },
      ]
    );
    expect(result.trackingCodeRequired).toBe(true);
  });
  it('applies an explicit provider to each item', () => {
    const result = resolvePackProviders(['ITEM-1'], [], 'SP-1');
    expect(result.providerByItem.get('ITEM-1')).toBe('SP-1');
  });
});
