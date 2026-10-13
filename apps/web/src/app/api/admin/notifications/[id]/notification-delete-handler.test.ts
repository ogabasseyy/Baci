import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { deleteAdminNotification } from './notification-delete-handler';

function createSupabase(options?: {
  deleted?: { id: string } | null;
  existing?: unknown;
}) {
  const existing = options?.existing ?? {
    delivery_state: 'pending',
    delivery_attempts: 0,
    id: 'notification-1',
    sent_at: null,
  };
  const deleteQuery = {
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        options && Object.hasOwn(options, 'deleted')
          ? options.deleted
          : { id: 'notification-1' },
      error: null,
    }),
    select: vi.fn(),
  };
  deleteQuery.eq.mockReturnValue(deleteQuery);
  deleteQuery.is.mockReturnValue(deleteQuery);
  deleteQuery.select.mockReturnValue(deleteQuery);
  const query = {
    delete: vi.fn(() => deleteQuery),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: existing,
      error: existing ? null : { code: 'PGRST116' },
    }),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return { from: vi.fn(() => query), deleteQuery };
}

describe('deleteAdminNotification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps non-pending delivery history intact', async () => {
    const supabase = createSupabase({
      existing: {
        delivery_state: 'sent',
        id: 'notification-1',
        sent_at: '2026-08-05T10:00:00.000Z',
      },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await deleteAdminNotification('notification-1');

    expect(response.status).toBe(409);
    expect(supabase.deleteQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it('uses a pending-state compare-and-delete guard', async () => {
    const supabase = createSupabase();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await deleteAdminNotification('notification-1');

    expect(response.status).toBe(200);
    expect(supabase.deleteQuery.eq).toHaveBeenCalledWith(
      'delivery_state',
      'pending'
    );
    expect(supabase.deleteQuery.eq).toHaveBeenCalledWith(
      'delivery_attempts',
      0
    );
    expect(supabase.deleteQuery.is).toHaveBeenCalledWith('sent_at', null);
  });

  it('does not delete a notification awaiting retry after an earlier attempt', async () => {
    const supabase = createSupabase({
      existing: {
        delivery_attempts: 1,
        delivery_state: 'pending',
        id: 'notification-1',
        sent_at: null,
      },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await deleteAdminNotification('notification-1');

    expect(response.status).toBe(409);
    expect(supabase.deleteQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it('reports a delivery race when the guarded delete finds no row', async () => {
    const supabase = createSupabase({ deleted: null });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await deleteAdminNotification('notification-1');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Notification delivery has already started',
    });
  });
});
