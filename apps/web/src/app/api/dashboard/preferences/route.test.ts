import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  createClient: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  toUserAccess: mocks.toUserAccess,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { GET, POST } from './route';

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(result)),
    upsert: vi.fn(() => query),
  };
  return query;
}

describe('dashboard preferences merchant context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.toUserAccess.mockReturnValue({ permissions: {} });
    mocks.checkCsrfProtection.mockResolvedValue({
      valid: true,
      response: null,
    });
  });

  it('reads preferences for the selected merchant', async () => {
    const query = createQuery({
      data: { layout_config: [], visible_cards: [] },
      error: null,
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => query),
    });

    const requestedMerchantId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await GET(
      new Request('https://usebaci.com/api/dashboard/preferences', {
        headers: { 'x-baci-merchant-id': requestedMerchantId },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
  });

  it('lets settings editors hydrate preferences when view is not granted', async () => {
    const query = createQuery({
      data: { layout_config: [], visible_cards: [] },
      error: null,
    });
    mocks.hasPermission.mockImplementation(
      (_access: unknown, _resource: string, action: string) => action === 'edit'
    );
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(
      new Request('https://usebaci.com/api/dashboard/preferences')
    );

    expect(response.status).toBe(200);
    expect(mocks.hasPermission).toHaveBeenNthCalledWith(
      1,
      { permissions: {} },
      'settings',
      'view'
    );
    expect(mocks.hasPermission).toHaveBeenNthCalledWith(
      2,
      { permissions: {} },
      'settings',
      'edit'
    );
  });

  it('forbids staff without settings view or edit access', async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(),
    });

    const response = await GET(
      new Request('https://usebaci.com/api/dashboard/preferences')
    );

    expect(response.status).toBe(403);
    expect(mocks.hasPermission).toHaveBeenCalledTimes(2);
  });

  it('writes preferences for the selected merchant', async () => {
    const query = createQuery({
      data: { layout_config: [], visible_cards: [] },
      error: null,
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => query),
    });

    const requestedMerchantId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: JSON.stringify({ layout_config: [] }),
        headers: {
          'Content-Type': 'application/json',
          'x-baci-merchant-id': requestedMerchantId,
        },
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
  });

  it('accepts a valid responsive layout containing only known widgets', async () => {
    const query = createQuery({
      data: { layout_config: { lg: [] }, visible_cards: ['ads-reporting'] },
      error: null,
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => query),
    });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: JSON.stringify({
          layout_config: {
            lg: [{ h: 3, i: 'ads-reporting', w: 12, x: 0, y: 4 }],
          },
          visible_cards: ['ads-reporting'],
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        layout_config: {
          lg: [{ h: 3, i: 'ads-reporting', w: 12, x: 0, y: 4 }],
        },
        visible_cards: ['ads-reporting'],
      }),
      { onConflict: 'merchant_id' }
    );
  });

  it('preserves the saved layout when updating only visible cards', async () => {
    const query = createQuery({
      data: {
        layout_config: {
          lg: [{ h: 3, i: 'ads-reporting', w: 12, x: 0, y: 4 }],
        },
        visible_cards: ['social-ads-reporting'],
      },
      error: null,
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => query),
    });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: JSON.stringify({ visible_cards: ['social-ads-reporting'] }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(query.upsert).toHaveBeenCalledWith(
      {
        merchant_id: 'merchant-1',
        updated_at: expect.any(String),
        visible_cards: ['social-ads-reporting'],
      },
      { onConflict: 'merchant_id' }
    );
  });

  it('returns 400 for malformed JSON without persisting preferences', async () => {
    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: '{',
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('returns 400 for a layout with an unapproved widget id', async () => {
    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: JSON.stringify({
          layout_config: [{ h: 1, i: 'unapproved-widget', w: 1, x: 0, y: 0 }],
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('rejects an oversized preferences payload before parsing it', async () => {
    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: '{}',
        headers: { 'content-length': String(32 * 1024 + 1) },
        method: 'POST',
      })
    );

    expect(response.status).toBe(413);
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('authenticates before rejecting an invalid CSRF token', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    mocks.createClient.mockReturnValue({ auth: { getUser } });
    mocks.checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: null,
    });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/dashboard/preferences', {
        body: JSON.stringify({ layout_config: [] }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(getUser).toHaveBeenCalledOnce();
    expect(mocks.checkCsrfProtection).not.toHaveBeenCalled();
  });
});
