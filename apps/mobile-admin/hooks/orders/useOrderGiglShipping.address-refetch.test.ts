// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushPromises,
  saveTypedCityAndState,
  server,
  trim,
} from './useOrderGiglShipping.address-save.test-support';
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

describe('bugfix: the order refetch after an address save asked for the bound quote again', () => {
  beforeEach(() => {
    server.getQuote.mockReset();
    server.patch.mockReset();
    server.getQuote.mockImplementation(async () => {
      const stored = server.storedAddress;
      if (!trim(stored.city) || !trim(stored.state)) {
        throw Object.assign(new Error('Incomplete'), {
          code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
          missing: ['city', 'state'],
        });
      }
      return quoteResult;
    });
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
  });

  it('keeps the bound quote when the refreshed order carries the saved address', async () => {
    const { order, rerender, result } = await saveTypedCityAndState();
    expect(server.patch).toHaveBeenCalledOnce();
    const requestsAfterBind = server.getQuote.mock.calls.length;

    rerender({
      current: { ...order, shipping_address: server.storedAddress },
    });
    await flushPromises();

    // Every /api/orders request shares one small per-IP rate limit.
    expect(server.getQuote).toHaveBeenCalledTimes(requestsAfterBind);
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
  });

  it('asks again when the refreshed order carries a different address', async () => {
    const { order, rerender, result } = await saveTypedCityAndState();
    const requestsAfterBind = server.getQuote.mock.calls.length;
    server.storedAddress = { ...server.storedAddress, state: 'Ogun' };

    rerender({
      current: { ...order, shipping_address: server.storedAddress },
    });
    await flushPromises();

    expect(server.getQuote).toHaveBeenCalledTimes(requestsAfterBind + 1);
    expect(server.getQuote).toHaveBeenLastCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
  });
});
