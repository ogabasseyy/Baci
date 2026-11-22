// @vitest-environment jsdom

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderGiglReceiver } from '@/lib/order-gigl-shipping';
import {
  differsFromStored,
  flushPromises,
  renderBoundQuote,
  server,
  trim,
} from './useOrderGiglShipping.address-save.test-support';
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

describe('bugfix: GIG bind refused typed address details as stale inputs', () => {
  beforeEach(() => {
    server.getQuote.mockReset();
    server.patch.mockReset();
    server.getQuote.mockImplementation(
      async (_orderId: string, receiver?: OrderGiglReceiver) => {
        if (receiver && differsFromStored(receiver)) {
          throw Object.assign(
            new Error('Order address or items changed since this quote.'),
            { code: 'stale_order_quote_inputs', status: 409 }
          );
        }
        const stored = server.storedAddress;
        if (!trim(stored.city) || !trim(stored.state)) {
          throw Object.assign(new Error('Incomplete'), {
            code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
            missing: [
              ...(trim(stored.city) ? [] : ['city']),
              ...(trim(stored.state) ? [] : ['state']),
            ],
          });
        }
        return quoteResult;
      }
    );
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
  });

  it('uses the saved address for a manual order until an explicit edit is saved', async () => {
    const { result } = renderBoundQuote({
      source: 'physical',
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        state: 'Lagos',
        name: 'Ada',
        phone: '0801',
      },
    });
    await flushPromises();
    expect(result.current.addressDraft.address).toBe('1 Allen');
    expect(server.patch).not.toHaveBeenCalled();
    expect(result.current.state).toBe('ready');

    act(() => result.current.beginAddressEdit?.());
    expect(result.current.missingFields).not.toContain('phone');
    act(() => {
      result.current.updateAddressField('address', '10 Hospital Road');
      result.current.updateAddressField('city', 'Lokoja');
      result.current.updateAddressField('state', 'Kogi');
    });
    expect(result.current.quote).toBeNull();
    expect(server.patch).not.toHaveBeenCalled();
    server.getQuote.mockClear();
    server.getQuote.mockImplementationOnce(async (_id, receiver) => {
      expect(receiver).toBeUndefined();
      expect(server.storedAddress).toMatchObject({
        address: '10 Hospital Road',
        city: 'Lokoja',
        state: 'Kogi',
      });
      return quoteResult;
    });
    await act(() => result.current.saveAddressAndRequestQuote());
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('does not price a manual order when saving the edited destination fails', async () => {
    const { result } = renderBoundQuote({
      source: 'physical',
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', city: 'Ikeja', state: 'Lagos' },
    });
    await flushPromises();
    server.getQuote.mockClear();
    server.patch.mockRejectedValueOnce(new Error('Address save failed'));
    act(() => result.current.beginAddressEdit?.());
    act(() => result.current.updateAddressField('city', 'Lokoja'));

    await act(() => result.current.saveAddressAndRequestQuote());

    expect(server.patch).toHaveBeenCalledOnce();
    expect(server.getQuote).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Address save failed');
  });

  it('asks the merchant to review the saved address after a stale quote response', async () => {
    server.getQuote.mockRejectedValueOnce(
      Object.assign(new Error('Stale quote'), {
        code: 'stale_order_quote_inputs',
      })
    );
    const { result } = renderBoundQuote({
      source: 'physical',
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', city: 'Ikeja', state: 'Lagos' },
    });
    await flushPromises();

    expect(result.current.addressDraft.address).toBe('1 Allen');
    expect(result.current.state).toBe('missing_address');
    expect(result.current.missingFields).toContain('address');
    expect(result.current.error).toMatch(/review the delivery address/i);
    expect(server.patch).not.toHaveBeenCalled();
  });

  it('reveals locality fields when a street edit clears them from an address-only missing state', async () => {
    server.getQuote.mockRejectedValueOnce(
      Object.assign(new Error('Incomplete'), {
        code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
        missing: ['address'],
      })
    );
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        city: 'Ikeja',
        name: 'Ada',
        phone: '0801',
        state: 'Lagos',
      },
    });
    await flushPromises();

    expect(result.current.missingFields).toEqual(['address']);
    act(() => result.current.updateAddressField('address', '10 Hospital Road'));
    expect(result.current.missingFields).toEqual(['address', 'city', 'state']);

    act(() => {
      result.current.updateAddressField('city', 'Yaba');
      result.current.updateAddressField('state', 'Lagos');
    });
    await act(() => result.current.saveAddressAndRequestQuote());

    expect(server.patch).toHaveBeenCalledOnce();
    expect(server.storedAddress).toMatchObject({
      address: '10 Hospital Road',
      city: 'Yaba',
      state: 'Lagos',
    });
  });

  it('saves typed city and state to the order before binding instead of failing with 409', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
    });
    await flushPromises();
    expect(result.current.missingFields).toEqual(['city', 'state']);

    act(() => {
      result.current.updateAddressField('city', 'Ikeja');
      result.current.updateAddressField('state', 'Lagos');
    });
    await act(() => result.current.saveAddressAndRequestQuote());

    expect(server.patch).toHaveBeenCalledWith({
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '0801',
        state: 'Lagos',
      },
    });
    expect(server.getQuote).toHaveBeenLastCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
  });

  it('uses the saved customer phone fallback without editing the order', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '',
        state: 'Lagos',
      },
    });
    await flushPromises();

    expect(server.patch).not.toHaveBeenCalled();
    expect(result.current.addressDraft.phone).toBe('0801');
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('ready');
  });

  it('binds without saving or sending an override when the stored address is already complete', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '0801',
        state: 'Lagos',
      },
    });
    await flushPromises();

    expect(server.patch).not.toHaveBeenCalled();
    expect(server.getQuote).toHaveBeenCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(result.current.state).toBe('ready');
  });
});
