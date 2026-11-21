// @vitest-environment jsdom

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushPromises,
  renderBoundQuote,
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

  it('keeps the explicit delivery draft while the same order refreshes', async () => {
    const order = {
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', city: 'Ikeja', state: 'Lagos' },
    };
    const { result, rerender } = renderBoundQuote(order);
    await flushPromises();
    act(() => {
      result.current.beginAddressEdit?.();
      result.current.updateAddressField('address', '2 Merchant Road');
    });
    const quoteCallsBeforeRefresh = server.getQuote.mock.calls.length;
    server.storedAddress = { ...server.storedAddress, city: 'Yaba' };
    rerender({ current: { ...order, shipping_address: server.storedAddress } });
    await flushPromises();
    expect(result.current.addressDraft.address).toBe('2 Merchant Road');
    expect(result.current.state).toBe('missing_address');
    expect(server.getQuote).toHaveBeenCalledTimes(quoteCallsBeforeRefresh);
    expect(server.patch).not.toHaveBeenCalled();
  });

  it('lets an explicit address save finish when fresh order data arrives', async () => {
    const order = {
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', city: 'Ikeja', state: 'Lagos' },
    };
    const { result, rerender } = renderBoundQuote(order);
    await flushPromises();
    act(() => {
      result.current.beginAddressEdit?.();
      result.current.updateAddressField('address', '2 Merchant Road');
    });
    const patch = Promise.withResolvers<void>();
    server.patch.mockReturnValueOnce(patch.promise);
    let save: Promise<unknown> | undefined;
    act(() => {
      save = result.current.saveAddressAndRequestQuote();
    });
    server.storedAddress = { ...server.storedAddress, city: 'Yaba' };
    rerender({ current: { ...order, shipping_address: server.storedAddress } });
    await act(async () => {
      patch.resolve();
      await save;
    });
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
  });

  it('rejects a delayed quote when the saved destination has changed', async () => {
    const order = {
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', city: 'Ikeja', state: 'Lagos' },
    };
    const { result, rerender } = renderBoundQuote(order);
    await flushPromises();
    act(() => {
      result.current.beginAddressEdit?.();
      result.current.updateAddressField('address', '2 Merchant Road');
    });
    const delayedQuote = Promise.withResolvers<typeof quoteResult>();
    server.getQuote.mockReturnValueOnce(delayedQuote.promise);
    let save: Promise<unknown> | undefined;
    act(() => {
      save = result.current.saveAddressAndRequestQuote();
    });
    await flushPromises();
    expect(server.patch).toHaveBeenCalledOnce();
    expect(server.getQuote).toHaveBeenCalledTimes(2);
    server.storedAddress = { ...server.storedAddress, address: '3 New Road' };
    rerender({ current: { ...order, shipping_address: server.storedAddress } });
    await act(async () => {
      delayedQuote.resolve(quoteResult);
      await save;
    });
    expect(result.current.quote).toBeNull();
    expect(result.current.addressDraft.address).toBe('3 New Road');
    expect(result.current.error).toMatch(/review the delivery address/i);
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
