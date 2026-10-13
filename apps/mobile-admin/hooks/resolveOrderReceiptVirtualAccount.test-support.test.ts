import { afterEach, describe, expect, it } from 'vitest';
import {
  makeOrder,
  receiptResolverTestMocks,
  setupReceiptResolverTest,
  teardownReceiptResolverTest,
} from './resolveOrderReceiptVirtualAccount.test-support';

describe('receipt virtual account test support', () => {
  afterEach(teardownReceiptResolverTest);

  it('builds an overridable order and installs the shared fetch mock', () => {
    setupReceiptResolverTest();

    expect(makeOrder({ order_number: 'ORD-2' }).order_number).toBe('ORD-2');
    expect(globalThis.fetch).toBe(receiptResolverTestMocks.fetch);
  });
});
