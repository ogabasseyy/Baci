import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import { GET, PATCH } from './route';

const NOTIFICATION_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174002';
const visibleNotification = {
  banner_dismissed_at: null,
  created_at: '2026-08-05T00:00:00.000Z',
  dismissed_at: null,
  id: NOTIFICATION_ID,
  merchant_id: '123e4567-e89b-12d3-a456-426614174001',
  notification: {
    action_label: null,
    action_url: null,
    channels: ['in_app'],
    created_at: '2026-08-05T00:00:00.000Z',
    delivery_state: 'sent',
    expires_at: null,
    id: '123e4567-e89b-12d3-a456-426614174003',
    is_system: false,
    message: 'New stock is available.',
    notification_type: 'info',
    priority: 'normal',
    sent_at: '2026-08-05T00:00:00.000Z',
    title: 'Inventory update',
  },
  notification_id: '123e4567-e89b-12d3-a456-426614174003',
  read_at: null,
} as const;

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn(() => true) }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: '123e4567-e89b-12d3-a456-426614174001',
    staffAccess: {},
  }),
  toUserAccess: vi.fn(() => ({ role: 'owner' })),
}));

interface QueryResult {
  count?: number | null;
  data?: Record<string, unknown> | Record<string, unknown>[] | null;
  error?: { message: string } | null;
}

function makeQuery(result: QueryResult, terminalOr = false) {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    or: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    update: vi.fn(),
  };

  for (const method of [
    query.eq,
    query.in,
    query.is,
    query.select,
    query.update,
  ]) {
    method.mockReturnValue(query);
  }
  query.or.mockReturnValue(terminalOr ? Promise.resolve(result) : query);
  return query;
}

describe('Notifications API: /api/notifications/[id]', () => {
  let authUser: { id: string } | null;
  let queryQueue: ReturnType<typeof makeQuery>[];

  const request = (body: unknown) =>
    new NextRequest(`http://localhost/api/notifications/${NOTIFICATION_ID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  const routeParams = (id = NOTIFICATION_ID) => ({
    params: Promise.resolve({ id }),
  });
  const getRequest = (id = NOTIFICATION_ID) =>
    new NextRequest(`http://localhost/api/notifications/${id}`);

  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    queryQueue = [];
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })),
      },
      from: vi.fn(() => queryQueue.shift() ?? makeQuery({ data: null })),
    } as unknown as ReturnType<typeof createClient>);
  });

  it('returns 401 before checking CSRF when PATCH is unauthenticated', async () => {
    authUser = null;

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('rejects a CSRF failure before checking recipient visibility', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: false });

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(403);
    expect(queryQueue).toHaveLength(0);
  });

  it('rejects malformed recipient IDs and unrecognized update fields', async () => {
    const invalidId = await PATCH(
      request({ read: true }),
      routeParams('bad-id')
    );
    const invalidBody = await PATCH(request({ hidden: true }), routeParams());

    expect(invalidId.status).toBe(400);
    expect(await invalidId.json()).toEqual({
      error: 'Invalid notification ID',
    });
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toEqual({
      error: 'Invalid notification update',
    });
  });

  it('rejects a no-op recipient update before querying or mutating', async () => {
    const response = await PATCH(request({}), routeParams());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid notification update',
    });
    expect(queryQueue).toHaveLength(0);
  });

  it('returns 400 for malformed JSON after authentication and CSRF', async () => {
    const malformedRequest = new NextRequest(
      `http://localhost/api/notifications/${NOTIFICATION_ID}`,
      { body: '{', method: 'PATCH' }
    );

    const response = await PATCH(malformedRequest, routeParams());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid notification update',
    });
    expect(checkCsrfProtection).toHaveBeenCalled();
  });

  it('does not reveal or mutate an expired or non-final parent', async () => {
    const recipientQuery = makeQuery({ data: null, error: null });
    queryQueue.push(recipientQuery);

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(404);
    expect(recipientQuery.update).not.toHaveBeenCalled();
    expect(recipientQuery.eq).toHaveBeenCalledWith(
      'notification.delivery_state',
      'sent'
    );
    expect(recipientQuery.or).toHaveBeenCalledWith(
      expect.stringContaining('expires_at.is.null'),
      { referencedTable: 'notification' }
    );
  });

  it('updates a visible final recipient and counts the same in-app scope', async () => {
    const recipientQuery = makeQuery({
      data: { id: NOTIFICATION_ID },
      error: null,
    });
    const updateQuery = makeQuery({
      data: { id: NOTIFICATION_ID, read_at: '2026-08-05T00:00:00.000Z' },
      error: null,
    });
    const countQuery = makeQuery({ count: 3, error: null }, true);
    queryQueue.push(recipientQuery, updateQuery, countQuery);

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unread_count: 3 });
    expect(updateQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('banner_dismissed_at')
    );
    expect(countQuery.eq).toHaveBeenCalledWith('in_app_visible', true);
    expect(countQuery.eq).toHaveBeenCalledWith(
      'notification.delivery_state',
      'sent'
    );
    expect(countQuery.is).toHaveBeenCalledWith('dismissed_at', null);
  });

  it('reports a nullable unread count instead of falsely reporting zero', async () => {
    queryQueue.push(
      makeQuery({ data: { id: NOTIFICATION_ID }, error: null }),
      makeQuery({ data: { id: NOTIFICATION_ID }, error: null }),
      makeQuery({ count: null, error: { message: 'count failed' } }, true)
    );

    const response = await PATCH(request({ dismissed: true }), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unread_count: null });
  });

  it('validates the GET ID and applies final/unexpired parent filters', async () => {
    const invalid = await GET(getRequest('bad-id'), routeParams('bad-id'));
    const detailQuery = makeQuery({
      data: visibleNotification,
      error: null,
    });
    queryQueue.push(detailQuery);
    const response = await GET(getRequest(), routeParams());

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(200);
    expect(detailQuery.eq).toHaveBeenCalledWith(
      'notification.delivery_state',
      'sent'
    );
    expect(detailQuery.or).toHaveBeenCalledWith(
      expect.stringContaining('expires_at.is.null'),
      { referencedTable: 'notification' }
    );
  });

  it('fails closed when the detail join is malformed', async () => {
    queryQueue.push(makeQuery({ data: { id: NOTIFICATION_ID }, error: null }));

    const response = await GET(getRequest(), routeParams());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notification',
    });
  });

  it('fails closed without mutating when recipient validation has a database error', async () => {
    const recipientQuery = makeQuery({
      data: null,
      error: { message: 'untrusted database message' },
    });
    queryQueue.push(recipientQuery);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update notification',
    });
    expect(recipientQuery.update).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to validate notification recipient',
      { errorCode: 'unknown' }
    );
  });

  it('does not claim success when the recipient state write fails', async () => {
    const recipientQuery = makeQuery({
      data: { id: NOTIFICATION_ID },
      error: null,
    });
    const updateQuery = makeQuery({
      data: null,
      error: { message: 'untrusted database message' },
    });
    queryQueue.push(recipientQuery, updateQuery);

    const response = await PATCH(request({ read: true }), routeParams());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update notification',
    });
  });
});
