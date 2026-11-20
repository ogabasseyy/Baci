// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStaffFollowUpQueue } from './useStaffFollowUpQueue';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  source: vi.fn(),
  staff: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mocks.auth }));
vi.mock('@/hooks/useFollowUpQueue', () => ({ useFollowUpQueue: mocks.source }));
vi.mock('@/hooks/useStaffOrderFollowUps', () => ({
  useStaffOrderFollowUps: mocks.staff,
}));

describe('useStaffFollowUpQueue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { id: 'staff-1' } });
    mocks.source.mockReturnValue({ merchant: { id: 'store-1' } });
    mocks.staff.mockReturnValue({});
  });

  it('scopes reads to the resolved store and staff member with sorted source IDs', () => {
    mocks.source.mockReturnValue({
      merchant: { id: 'store-2' },
      failedOrders: [{ id: 'b' }, { id: 'a' }],
    });
    renderHook(() => useStaffFollowUpQueue());
    expect(mocks.staff).toHaveBeenCalledWith('store-2', 'staff-1', ['a', 'b']);
  });

  it('preserves source payment details, retains open staff-only orders, and hides closed orders', () => {
    const source = { id: 'same', payment_method: 'oxygen' };
    const retained = { id: 'retained', staff_follow_up_only: true };
    const closed = { id: 'closed', payment_method: 'paystack' };
    mocks.source.mockReturnValue({ failedOrders: [source, closed] });
    mocks.staff.mockReturnValue({
      openOrders: [{ id: 'same', staff_follow_up_only: true }, retained],
      data: { closed: { stage: 'closed' } },
    });
    const { result } = renderHook(() => useStaffFollowUpQueue());
    expect(result.current.orders).toEqual([source, retained]);
    expect(result.current.ordersById.get('closed')).toBe(closed);
  });

  it.each([
    ['2026-11-20T08:00:00Z', '2026-11-20T12:00:00Z'],
    ['2026-11-21T08:00:00Z', '2026-11-21T08:00:00Z'],
  ])('preserves the newest activity when an order is in both feeds (%s)', (providerActivity, latest) => {
    const source = {
      id: 'same',
      payment_method: 'oxygen',
      oxygen_follow_up_status: 'oxygen_processing',
      follow_up_at: providerActivity,
    };
    mocks.source.mockReturnValue({ failedOrders: [source] });
    mocks.staff.mockReturnValue({
      openOrders: [{ id: 'same', staff_follow_up_only: true }],
      data: { same: { stage: 'waiting', updated_at: '2026-11-20T12:00:00Z' } },
    });

    const { result } = renderHook(() => useStaffFollowUpQueue());
    expect(result.current.orders).toEqual([
      { ...source, follow_up_at: latest },
    ]);
  });

  it('passes through staff loading and errors and keeps the checkout rows available', () => {
    mocks.auth.mockReturnValue({ user: null });
    const source = { failedOrders: [{ id: 'order' }] };
    mocks.source.mockReturnValue(source);
    const staffLoading = { isLoading: true };
    mocks.staff.mockReturnValue(staffLoading);
    const { result, rerender } = renderHook(() => useStaffFollowUpQueue());
    expect(mocks.staff).toHaveBeenCalledWith(undefined, undefined, ['order']);
    expect(result.current.staff).toBe(staffLoading);
    expect(result.current.orders).toEqual(source.failedOrders);

    const staffError = { isError: true };
    mocks.staff.mockReturnValue(staffError);
    rerender();
    expect(result.current.staff).toBe(staffError);
    expect(result.current.orders).toEqual(source.failedOrders);
  });
});
