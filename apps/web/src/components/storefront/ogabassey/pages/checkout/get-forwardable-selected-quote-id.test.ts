import { describe, expect, it } from 'vitest';
import { getForwardableSelectedQuoteId } from './get-forwardable-selected-quote-id';

describe('getForwardableSelectedQuoteId', () => {
  it('forwards carrier quote ids and omits merchant rate ids', () => {
    expect(getForwardableSelectedQuoteId('door', 'door-1')).toBe('door-1');
    expect(
      getForwardableSelectedQuoteId(
        'door',
        'mrate_9f1b2c3d-0000-4000-8000-000000000001',
      ),
    ).toBeUndefined();
    expect(getForwardableSelectedQuoteId('airport', 'air-1')).toBeUndefined();
  });
});
