// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadStorefrontCustomerTaxSubtotals } from './storefront-customer-tax-subtotals';

const vatRow = {
  order_id: 'order-1',
  vat_category_code: 'S',
  vat_rate: 7.5,
  taxable_amount: 100,
  tax_amount: 7.5,
  exemption_reason: null,
};

function clientReturning(batches: { data: unknown[]; error: unknown }[]) {
  const rpc = vi.fn(async () => batches.shift() ?? { data: [], error: null });
  return { rpc, client: { rpc } as never };
}

describe('loadStorefrontCustomerTaxSubtotals', () => {
  it('skips the RPC entirely when no order ids are requested', async () => {
    const { rpc, client } = clientReturning([]);
    const result = await loadStorefrontCustomerTaxSubtotals(client, []);
    expect(result).toEqual({ data: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('loads one batch through the ownership-checked RPC', async () => {
    const { rpc, client } = clientReturning([{ data: [vatRow], error: null }]);
    const result = await loadStorefrontCustomerTaxSubtotals(client, [
      'order-1',
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_customer_order_tax_subtotals', {
      p_order_ids: ['order-1'],
    });
    expect(result).toEqual({ data: [vatRow], error: null });
  });

  it('dedupes order ids before the lookup', async () => {
    const { rpc, client } = clientReturning([{ data: [], error: null }]);
    await loadStorefrontCustomerTaxSubtotals(client, [
      'order-1',
      'order-1',
      'order-2',
    ]);
    expect(rpc).toHaveBeenCalledWith('get_customer_order_tax_subtotals', {
      p_order_ids: ['order-1', 'order-2'],
    });
  });

  it('pages lookups larger than the per-call cap', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `order-${i}`);
    const { rpc, client } = clientReturning([
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await loadStorefrontCustomerTaxSubtotals(client, ids);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[2][1].p_order_ids).toHaveLength(50);
  });

  it('keeps fetched rows and surfaces the batch error', async () => {
    const failure = { message: 'boom' };
    const { client } = clientReturning([
      { data: [vatRow], error: null },
      { data: [], error: failure },
    ]);
    const ids = Array.from({ length: 101 }, (_, i) => `order-${i}`);
    const result = await loadStorefrontCustomerTaxSubtotals(client, ids);
    expect(result).toEqual({ data: [vatRow], error: failure });
  });
});
