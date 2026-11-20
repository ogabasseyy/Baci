import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLLOW_UP_QUERY_LIMIT } from '@/config/follow-up-queue';
import {
  failed,
  followUp,
  MERCHANT,
  ok,
  openRow,
  orderId,
  queryBuilder,
  render,
  VIEWER,
} from '@/test/fixtures/staff-follow-up-hook';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

describe('useStaffOrderFollowUps', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockImplementation(() => queryBuilder(ok([])).builder);
  });

  describe('loading', () => {
    it('loads the signed-in user’s follow-up write capability for this store', async () => {
      mocks.rpc.mockResolvedValue(ok(true));
      const { result } = render();
      await waitFor(() => expect(result.current.canWrite).toBe(true));
      expect(mocks.rpc).toHaveBeenCalledWith('can_write_order_follow_ups', {
        p_merchant_id: MERCHANT,
      });
    });

    it('distinguishes a failed capability check from a successful denial', async () => {
      mocks.rpc
        .mockResolvedValueOnce(failed())
        .mockResolvedValueOnce(ok(false));
      const { result } = render();
      await waitFor(() => expect(result.current.isWriteAccessError).toBe(true));
      expect(result.current.canWrite).toBe(false);
      await result.current.refetchWriteAccess();
      await waitFor(() =>
        expect(result.current.isWriteAccessError).toBe(false)
      );
      expect(result.current.canWrite).toBe(false);
    });

    it('does not query until the store and the viewer are known', () => {
      const noStore = render([], { viewerId: VIEWER });
      const noViewer = render([], { merchantId: MERCHANT });

      expect(noStore.result.current.fetchStatus).toBe('idle');
      expect(noViewer.result.current.fetchStatus).toBe('idle');
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('scans every open follow-up of the store, including orphaned ones with no assignee', async () => {
      const open = queryBuilder(
        ok([
          openRow(1),
          openRow(2, { assignee_id: null, assignee_name: 'Former teammate' }),
        ])
      );
      mocks.from.mockReturnValueOnce(open.builder);

      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mocks.from).toHaveBeenCalledWith('order_follow_ups');
      expect(open.calls).toContainEqual(['eq', ['merchant_id', MERCHANT]]);
      expect(open.calls).toContainEqual([
        'eq',
        ['order.merchant_id', MERCHANT],
      ]);
      expect(open.calls).toContainEqual(['neq', ['stage', 'closed']]);
      expect(open.calls).toContainEqual(['limit', [FOLLOW_UP_QUERY_LIMIT + 1]]);
      // bugfix: filtering on assignee_id hid orphaned follow-ups from reclaiming.
      expect(open.calls.some(([method]) => method === 'not')).toBe(false);
      expect(result.current.openOrders?.map((order) => order.id)).toEqual([
        orderId(1),
        orderId(2),
      ]);
      expect(result.current.data?.[orderId(2)]?.assignee_id).toBeNull();
    });

    it('turns an open follow-up into a queue entry for an order outside the source queue', async () => {
      mocks.from.mockReturnValueOnce(
        queryBuilder(
          ok([
            openRow(
              1,
              {},
              {
                customer_name: null,
                customer_email: null,
                customer_phone: null,
                order_number: null,
                payment_method: null,
                total: null,
                created_at: null,
              }
            ),
            openRow(
              2,
              {},
              { total: 'not-a-number', payment_status: 'bnpl_approved' }
            ),
          ])
        ).builder
      );

      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.openOrders?.[0]).toMatchObject({
        id: orderId(1),
        order_number: '',
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        payment_method: '',
        total: null,
        created_at: '2026-11-19T10:00:00+00:00',
        payment_status: 'paid',
        attempt_count: 1,
        follow_up_at: '2026-11-19T10:00:00+00:00',
        staff_follow_up_only: true,
      });
      expect(result.current.openOrders?.[1]?.total).toBeNull();
      expect(result.current.openOrders?.[1]?.payment_status).toBe(
        'bnpl_approved'
      );
    });

    it('keeps an older order of a consolidated email group in the open entries', async () => {
      // Only the newest order per email is in orderIds; the older order's claim
      // must still come back from the open scan.
      const newest = orderId(9);
      mocks.from
        .mockReturnValueOnce(
          queryBuilder(ok([openRow(1, { stage: 'contacted' })])).builder
        )
        .mockReturnValueOnce(queryBuilder(ok([])).builder);

      const { result } = render([newest]);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.openOrders?.map((order) => order.id)).toEqual([
        orderId(1),
      ]);
      expect(result.current.data?.[orderId(1)]?.stage).toBe('contacted');
      expect(result.current.data?.[newest]).toBeUndefined();
    });

    it('fetches records only for source orders the open scan did not already return', async () => {
      const chunk = queryBuilder(ok([followUp(3, { stage: 'waiting' })]));
      mocks.from
        .mockReturnValueOnce(queryBuilder(ok([openRow(1)])).builder)
        .mockReturnValueOnce(chunk.builder);

      const { result } = render([orderId(1), orderId(3), orderId(4)]);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(chunk.calls).toContainEqual(['eq', ['merchant_id', MERCHANT]]);
      expect(chunk.calls).toContainEqual([
        'in',
        ['order_id', [orderId(3), orderId(4)]],
      ]);
      expect(Object.keys(result.current.data ?? {}).sort()).toEqual([
        orderId(1),
        orderId(3),
      ]);
      expect(result.current.openOrders).toHaveLength(1);
    });

    it('asks for source orders in chunks of 50', async () => {
      const ids = Array.from({ length: 120 }, (_, i) => orderId(i + 1));
      const chunks = [
        queryBuilder(ok([])),
        queryBuilder(ok([])),
        queryBuilder(ok([])),
      ];
      mocks.from
        .mockReturnValueOnce(queryBuilder(ok([])).builder)
        .mockReturnValueOnce(chunks[0].builder)
        .mockReturnValueOnce(chunks[1].builder)
        .mockReturnValueOnce(chunks[2].builder);

      const { result } = render(ids);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const sizes = chunks.map(
        (chunk) =>
          (chunk.calls.find(([method]) => method === 'in')?.[1][1] as string[])
            .length
      );
      expect(sizes).toEqual([50, 50, 20]);
    });

    it('reports the queue as limited when the open scan overflows its cap', async () => {
      const rows = Array.from({ length: FOLLOW_UP_QUERY_LIMIT + 1 }, (_, i) =>
        openRow(i + 1)
      );
      mocks.from.mockReturnValueOnce(queryBuilder(ok(rows)).builder);

      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.isLimited).toBe(true);
      expect(result.current.openOrders).toHaveLength(FOLLOW_UP_QUERY_LIMIT);
    });

    it('is not limited when the open scan fits the cap exactly', async () => {
      const rows = Array.from({ length: FOLLOW_UP_QUERY_LIMIT }, (_, i) =>
        openRow(i + 1)
      );
      mocks.from.mockReturnValueOnce(queryBuilder(ok(rows)).builder);

      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.isLimited).toBe(false);
    });
  });

  describe('load failures', () => {
    it('fails with a plain message when the open scan errors', async () => {
      mocks.from.mockReturnValueOnce(queryBuilder(failed()).builder);

      const { result } = render();
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        'Could not load open follow-ups.'
      );
    });

    it('fails with a plain message when a source-order chunk errors', async () => {
      mocks.from
        .mockReturnValueOnce(queryBuilder(ok([])).builder)
        .mockReturnValueOnce(queryBuilder(failed()).builder);

      const { result } = render([orderId(1)]);
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        'Could not load staff follow-ups.'
      );
    });

    it('fails with the plain message, not a raw validation error, when a source-order record breaks the follow-up contract', async () => {
      mocks.from
        .mockReturnValueOnce(queryBuilder(ok([])).builder)
        .mockReturnValueOnce(
          queryBuilder(ok([followUp(1, { stage: 'bogus' })])).builder
        );

      const { result } = render([orderId(1)]);
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        'Could not load staff follow-ups.'
      );
      expect(result.current.data).toBeUndefined();
    });

    it.each([
      ['follow-up', openRow(2, { stage: 'bogus' })],
      ['order', { ...openRow(2), order: { id: 'not-a-uuid' } }],
    ])('fails with the plain message when an open row has a malformed %s, even beside a valid one', async (_part, badRow) => {
      mocks.from.mockReturnValueOnce(
        queryBuilder(ok([openRow(1), badRow])).builder
      );

      const { result } = render();
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        'Could not load open follow-ups.'
      );
      expect(result.current.data).toBeUndefined();
    });
  });
});
