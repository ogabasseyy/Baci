import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  followUp,
  MERCHANT,
  ok,
  openRow,
  orderId,
  type QueryResult,
  queryBuilder,
  render,
  VIEWER,
} from '@/test/fixtures/staff-follow-up-hook';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

describe('useStaffOrderFollowUps saving', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockImplementation(() => queryBuilder(ok([])).builder);
  });

  describe('RPC calls', () => {
    it('claims through the claim function for this store and order', async () => {
      const claimed = followUp(1);
      mocks.rpc.mockResolvedValue({ data: claimed, error: null });
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      let saved: unknown;
      await act(async () => {
        saved = await result.current.save({
          type: 'claim',
          orderId: orderId(1),
        });
      });

      expect(mocks.rpc).toHaveBeenCalledWith('claim_order_follow_up', {
        p_merchant_id: MERCHANT,
        p_order_id: orderId(1),
      });
      expect(saved).toEqual(claimed);
    });

    it('updates through the update function with the revision it read', async () => {
      mocks.rpc.mockResolvedValue({
        data: followUp(1, { stage: 'waiting', revision: 4 }),
        error: null,
      });
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await act(async () => {
        await result.current.save({
          type: 'update',
          fields: {
            order_id: orderId(1),
            revision: 3,
            stage: 'waiting',
            outcome: 'Asked the customer to retry.',
            follow_up_on: '2026-12-01',
          },
        });
      });

      expect(mocks.rpc).toHaveBeenCalledWith('update_order_follow_up', {
        p_merchant_id: MERCHANT,
        p_order_id: orderId(1),
        p_revision: 3,
        p_stage: 'waiting',
        p_outcome: 'Asked the customer to retry.',
        p_follow_up_on: '2026-12-01',
      });
    });

    it('reloads the queue after a save settles', async () => {
      mocks.rpc.mockResolvedValue({ data: followUp(1), error: null });
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mocks.from).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.save({ type: 'claim', orderId: orderId(1) });
      });

      expect(mocks.from).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['claim', '23505', 'Someone else has already claimed this follow-up.'],
      ['claim', 'PT410', 'This follow-up is already closed.'],
      ['update', 'PT410', 'This follow-up is already closed.'],
      [
        'update',
        'PT409',
        'This follow-up changed. Check the latest details before saving.',
      ],
      [
        'claim',
        '42501',
        'This follow-up is no longer available to you. Refresh and try again.',
      ],
      [
        'update',
        '42501',
        'This follow-up is no longer available to you. Refresh and try again.',
      ],
      ['update', 'XX000', 'Could not save the follow-up. Try again.'],
      // bugfix: 40001 made PostgREST retry the transaction, so it is no longer the stale signal.
      ['update', '40001', 'Could not save the follow-up. Try again.'],
    ])('maps a failed %s (code %s) to a plain message', async (kind, code, message) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code } });
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const change =
        kind === 'claim'
          ? ({ type: 'claim', orderId: orderId(1) } as const)
          : ({
              type: 'update',
              fields: {
                order_id: orderId(1),
                revision: 1,
                stage: 'closed',
                outcome: '',
                follow_up_on: null,
              },
            } as const);

      await act(async () => {
        await expect(result.current.save(change)).rejects.toThrow(message);
      });
      await waitFor(() => expect(result.current.saveError).toBe(message));
      act(() => result.current.resetSave());
      await waitFor(() => expect(result.current.saveError).toBeUndefined());
    });

    it('tells the user the change was saved when the reply is not a valid follow-up', async () => {
      mocks.rpc.mockResolvedValue({ data: { order_id: 'nope' }, error: null });
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await act(async () => {
        await expect(
          result.current.save({ type: 'claim', orderId: orderId(1) })
        ).rejects.toThrow(
          'Saved, but the latest details could not be shown. Pull down to refresh.'
        );
      });
    });

    it('refuses to save when the store is unknown', async () => {
      const { result } = render([], { viewerId: VIEWER });

      await act(async () => {
        await expect(
          result.current.save({ type: 'claim', orderId: orderId(1) })
        ).rejects.toThrow('Store unavailable.');
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('explains an unsupported date before sending the update', async () => {
      mocks.rpc.mockResolvedValue(ok(true));
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await act(async () => {
        await expect(
          result.current.save({
            type: 'update',
            fields: {
              order_id: orderId(1),
              revision: 1,
              stage: 'waiting',
              outcome: '',
              follow_up_on: '1899-12-31',
            },
          })
        ).rejects.toThrow('Choose a follow-up date between 1900 and 9999.');
      });
      expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
        'update_order_follow_up'
      );
    });
  });

  describe('cache updates', () => {
    /** The reload a save triggers never finishes, so only the cache write is visible. */
    const holdNextReload = () =>
      mocks.from.mockReturnValueOnce(
        queryBuilder(new Promise<QueryResult>(() => {})).builder
      );

    it('shows a claimed follow-up straight away, before the reload finishes', async () => {
      const { result } = render([orderId(2)]);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[orderId(2)]).toBeUndefined();
      holdNextReload();
      mocks.rpc.mockResolvedValue({
        data: followUp(2, { revision: 2 }),
        error: null,
      });

      await act(async () => {
        void result.current.save({ type: 'claim', orderId: orderId(2) });
      });

      await waitFor(() =>
        expect(result.current.data?.[orderId(2)]?.assignee_id).toBe(VIEWER)
      );
      expect(result.current.data?.[orderId(2)]?.revision).toBe(2);
    });

    it('drops a closed follow-up from the open entries straight away', async () => {
      mocks.from.mockReturnValueOnce(
        queryBuilder(ok([openRow(1), openRow(2)])).builder
      );
      const { result } = render();
      await waitFor(() => expect(result.current.openOrders).toHaveLength(2));
      holdNextReload();
      mocks.rpc.mockResolvedValue({
        data: followUp(1, { stage: 'closed', revision: 2 }),
        error: null,
      });

      await act(async () => {
        void result.current.save({
          type: 'update',
          fields: {
            order_id: orderId(1),
            revision: 1,
            stage: 'closed',
            outcome: 'Customer declined.',
            follow_up_on: null,
          },
        });
      });

      await waitFor(() =>
        expect(result.current.openOrders?.map((order) => order.id)).toEqual([
          orderId(2),
        ])
      );
      expect(result.current.data?.[orderId(1)]?.stage).toBe('closed');
    });

    it('refreshes the retained activity timestamp before the reload finishes', async () => {
      mocks.from.mockReturnValueOnce(queryBuilder(ok([openRow(1)])).builder);
      const { result } = render();
      await waitFor(() => expect(result.current.openOrders).toHaveLength(1));
      holdNextReload();
      mocks.rpc.mockResolvedValue({
        data: followUp(1, {
          stage: 'waiting',
          revision: 2,
          updated_at: '2026-11-20T12:00:00+00:00',
        }),
        error: null,
      });

      await act(async () => {
        void result.current.save({
          type: 'update',
          fields: {
            order_id: orderId(1),
            revision: 1,
            stage: 'waiting',
            outcome: '',
            follow_up_on: null,
          },
        });
      });

      await waitFor(() =>
        expect(result.current.data?.[orderId(1)]?.stage).toBe('waiting')
      );
      expect(result.current.openOrders).toHaveLength(1);
      expect(result.current.openOrders?.[0]?.follow_up_at).toBe(
        '2026-11-20T12:00:00+00:00'
      );
    });
  });
});
