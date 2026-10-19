import { describe, expect, it, vi } from 'vitest';
import { appendCancelledStatusFences } from './append-cancelled-status-fences';

describe('appendCancelledStatusFences', () => {
  it('appends both cancellation spellings on both status axes', () => {
    const builder: {
      neq: (column: string, value: string) => typeof builder;
    } = {
      neq: vi.fn((_column: string, _value: string) => builder),
    };

    const result = appendCancelledStatusFences(builder);

    expect(result).toBe(builder);
    expect(builder.neq).toHaveBeenCalledTimes(4);
    expect(builder.neq).toHaveBeenCalledWith('payment_status', 'cancelled');
    expect(builder.neq).toHaveBeenCalledWith('payment_status', 'canceled');
    expect(builder.neq).toHaveBeenCalledWith('shipping_status', 'cancelled');
    expect(builder.neq).toHaveBeenCalledWith('shipping_status', 'canceled');
  });
});
