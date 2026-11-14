// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ link: vi.fn(), preview: vi.fn() }));

vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  AuthenticatedFetchPreflightError: class extends Error {},
}));
vi.mock('@/lib/order-gigl-external-waybill', () => {
  class GiglExternalWaybillError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message);
    }
  }
  return {
    GiglExternalWaybillError,
    linkOrderGiglExternalWaybill: api.link,
    previewOrderGiglExternalWaybill: api.preview,
  };
});

import { GiglExternalWaybillError } from '@/lib/order-gigl-external-waybill';
import { useOrderGiglExternalWaybill } from './useOrderGiglExternalWaybill';

const preview = {
  waybill: '1349639588',
  linkable: true,
  match: { name: 'match', phone: 'match', destination: 'match' },
  order: { customerName: 'Audu Emmanuel', orderNumber: 'ORD-1' },
  gig: null,
} as const;

function setup(beforeLink?: () => Promise<void>) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onLinked = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(
    () =>
      useOrderGiglExternalWaybill({ beforeLink, orderId: 'order-1', onLinked }),
    { wrapper }
  );
  return { hook, invalidate, onLinked };
}

describe('useOrderGiglExternalWaybill', () => {
  beforeEach(() => {
    api.link.mockReset();
    api.preview.mockReset();
  });

  it('checks the format before calling the server', async () => {
    const { hook } = setup();
    act(() => hook.result.current.setWaybill('12'));
    await act(() => hook.result.current.check());

    expect(api.preview).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe(
      'Enter the waybill number from the GIG app.'
    );
  });

  it('previews then attaches the waybill and refreshes the order', async () => {
    api.preview.mockResolvedValue(preview);
    api.link.mockResolvedValue({
      success: true,
      shipmentId: 'shipment-1',
      trackingNumber: '1349639588',
    });
    const { hook, invalidate, onLinked } = setup();

    act(() => hook.result.current.setWaybill(' 1349639588 '));
    await act(() => hook.result.current.check());
    expect(api.preview).toHaveBeenCalledWith('order-1', '1349639588');
    expect(hook.result.current.state).toBe('preview');
    expect(hook.result.current.preview).toEqual(preview);

    await act(() => hook.result.current.link());
    expect(api.link).toHaveBeenCalledWith('order-1', '1349639588');
    expect(onLinked).toHaveBeenCalledWith(
      expect.objectContaining({ trackingNumber: '1349639588' })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'order-1'] });
    expect(hook.result.current).toMatchObject({
      preview: null,
      state: 'idle',
      waybill: '',
    });
  });

  it('never links a waybill that does not match the order', async () => {
    api.preview.mockResolvedValue({ ...preview, linkable: false });
    const { hook } = setup();
    act(() => hook.result.current.setWaybill('1349639588'));
    await act(() => hook.result.current.check());
    await act(() => hook.result.current.link());
    expect(api.link).not.toHaveBeenCalled();
  });

  it('clears the preview when the waybill is edited', async () => {
    api.preview.mockResolvedValue(preview);
    const { hook } = setup();
    act(() => hook.result.current.setWaybill('1349639588'));
    await act(() => hook.result.current.check());
    act(() => hook.result.current.setWaybill('1349639589'));
    expect(hook.result.current).toMatchObject({ preview: null, state: 'idle' });
  });

  it('shows a definitive server refusal', async () => {
    api.preview.mockResolvedValue(preview);
    api.link.mockRejectedValue(
      new GiglExternalWaybillError(
        'This waybill is already attached to another order.',
        409,
        'WAYBILL_ALREADY_LINKED'
      )
    );
    const { hook, invalidate, onLinked } = setup();
    act(() => hook.result.current.setWaybill('1349639588'));
    await act(() => hook.result.current.check());
    await act(() => hook.result.current.link());

    expect(onLinked).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe(
      'This waybill is already attached to another order.'
    );
  });

  it('keeps the sheet open without linking when saving order details fails', async () => {
    api.preview.mockResolvedValue(preview);
    const { hook, onLinked } = setup(() =>
      Promise.reject(new Error('Could not save the IMEI or serial numbers.'))
    );
    act(() => hook.result.current.setWaybill('1349639588'));
    await act(() => hook.result.current.check());
    await act(() => hook.result.current.link());

    expect(api.link).not.toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      error: 'Could not save the IMEI or serial numbers.',
      state: 'preview',
    });
  });

  it('treats a lost response as unconfirmed and refreshes the order', async () => {
    api.preview.mockResolvedValue(preview);
    api.link.mockRejectedValue(new Error('Request timed out.'));
    const { hook, invalidate } = setup();
    act(() => hook.result.current.setWaybill('1349639588'));
    await act(() => hook.result.current.check());
    await act(() => hook.result.current.link());

    expect(hook.result.current.error).toMatch(/could not confirm the result/);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'order-1'] });
  });
});
