import { describe, expect, it } from 'vitest';
import { postShipOnCredit } from './ship-on-credit.test-support';

describe('POST /api/orders/[id]/ship-on-credit route contract', () => {
  it('exposes the route covered by the focused lifecycle and validation suites', () => {
    expect(postShipOnCredit).toBeTypeOf('function');
  });
});
