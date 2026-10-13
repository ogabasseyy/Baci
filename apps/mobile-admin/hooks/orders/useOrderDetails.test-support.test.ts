import { describe, expect, it } from 'vitest';
import {
  orderDetailsTestMocks,
  resetOrderDetailsMocks,
} from './useOrderDetails.test-support';

describe('useOrderDetails test support', () => {
  it('resets recorded Supabase query chains', () => {
    orderDetailsTestMocks.supabaseMock.from('orders');

    resetOrderDetailsMocks();

    expect(orderDetailsTestMocks.supabaseMock.chains).toEqual([]);
  });
});
