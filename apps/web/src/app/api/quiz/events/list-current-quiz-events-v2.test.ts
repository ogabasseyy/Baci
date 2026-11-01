import { describe, expect, it, vi } from 'vitest';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import {
  appQuizEvent,
  appQuizEventsResponse,
} from '@/components/storefront/ogabassey/pages/app-quiz-event.test-support';
import { listCurrentQuizEventsV2 } from './list-current-quiz-events-v2';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const id = (n: number) =>
  `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

function client(page: (offset: number) => { data: unknown; error: unknown }) {
  const rpc = vi.fn((_name: string, args?: Record<string, unknown>) =>
    Promise.resolve(page(Number(args?.p_offset)))
  );
  return { rpc, supabase: { rpc } as unknown as ServerSupabaseClient };
}

describe('listCurrentQuizEventsV2', () => {
  it('returns only active and scheduled events from one complete page', async () => {
    const { rpc, supabase } = client(() => ({
      data: appQuizEventsResponse([
        appQuizEvent({ id: id(1) }),
        appQuizEvent({ id: id(2), status: 'scheduled' }),
        appQuizEvent({ id: id(3), status: 'completed' }),
      ]),
      error: null,
    }));

    const result = await listCurrentQuizEventsV2(supabase, MERCHANT_ID);

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.events.map((event) => event.id)).toEqual([
      id(1),
      id(2),
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_quiz_events_v2', {
      p_limit: 50,
      p_merchant_id: MERCHANT_ID,
      p_offset: 0,
    });
  });

  describe('bugfix: live quiz pushed off the first page', () => {
    it('reads later pages so a live quiz on page two is listed', async () => {
      const { supabase } = client((offset) =>
        offset === 0
          ? {
              data: appQuizEventsResponse(
                [appQuizEvent({ id: id(1), status: 'completed' })],
                { hasMore: true, nextOffset: 50, offset }
              ),
              error: null,
            }
          : {
              data: appQuizEventsResponse([appQuizEvent({ id: id(2) })], {
                hasMore: false,
                nextOffset: null,
                offset,
              }),
              error: null,
            }
      );

      const result = await listCurrentQuizEventsV2(supabase, MERCHANT_ID);

      expect(result.ok && result.events.map((event) => event.id)).toEqual([
        id(2),
      ]);
    });

    it('stops after four pages', async () => {
      const { rpc, supabase } = client((offset) => ({
        data: appQuizEventsResponse([], {
          hasMore: true,
          nextOffset: offset + 50,
          offset,
        }),
        error: null,
      }));

      await listCurrentQuizEventsV2(supabase, MERCHANT_ID);

      expect(rpc).toHaveBeenCalledTimes(4);
    });
  });

  it('returns the RPC error without partial events', async () => {
    const error = { code: 'QZ031', message: 'not_authorized' };
    const { supabase } = client(() => ({ data: null, error }));

    expect(await listCurrentQuizEventsV2(supabase, MERCHANT_ID)).toEqual({
      error,
      ok: false,
    });
  });

  it('fails on a projection that breaks the v2 contract', async () => {
    const { supabase } = client(() => ({ data: { events: 'x' }, error: null }));

    const result = await listCurrentQuizEventsV2(supabase, MERCHANT_ID);

    expect(result.ok).toBe(false);
  });
});
