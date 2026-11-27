import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  getMerchantInboxBinding: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
  hasPermission: (
    access: {
      isOwner: boolean;
      permissions: Record<string, Record<string, boolean>>;
    },
    resource: string,
    action: string
  ) => access.isOwner || access.permissions[resource]?.[action] === true,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  toUserAccess: (ctx: {
    merchantId: string;
    staffAccess: {
      isOwner: boolean;
      isStaff: boolean;
      role: string | null;
      permissions: Record<string, Record<string, boolean>>;
    };
  }) => ({
    merchantId: ctx.merchantId,
    role: ctx.staffAccess.role || 'owner',
    isOwner: ctx.staffAccess.isOwner,
    isStaff: ctx.staffAccess.isStaff,
    permissions: ctx.staffAccess.permissions,
  }),
}));
vi.mock('./merchant-inbox-config', () => ({
  getMerchantInboxBinding: mocks.getMerchantInboxBinding,
}));

import { NextRequest } from 'next/server';
import { resolveMerchantInboxRequest } from './merchant-inbox-request';

const request = new NextRequest(
  'https://app.example.test/api/merchant/inbox/conversations'
);
const supabase = { marker: 'scoped-client' };

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const binding = {
  merchantId: MERCHANT_ID,
  accountId: 2,
  inboxId: 20,
  apiAccessToken: 'synthetic-agent-token-aaaa',
  apiOrigin: 'https://chat.example.test',
};

function owner() {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: {
      isOwner: true,
      isStaff: false,
      role: null,
      permissions: { full_access: { all: true } },
    },
  };
}

function staff(permissions: Record<string, Record<string, boolean>>) {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: { isOwner: false, isStaff: true, role: 'staff', permissions },
  };
}

async function failure(action: 'view' | 'edit' = 'view') {
  const result = await resolveMerchantInboxRequest(request, action);
  if (result.ok) throw new Error('expected a failure');
  return {
    status: result.response.status,
    body: await result.response.json(),
    cache: result.response.headers.get('cache-control'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    user: { id: 'user-1' },
    supabase,
    error: null,
  });
  mocks.getMerchantForApiRequest.mockResolvedValue(owner());
  mocks.getMerchantInboxBinding.mockReturnValue(binding);
});

describe('resolveMerchantInboxRequest', () => {
  it('returns the binding and the caller session client for an owner', async () => {
    await expect(resolveMerchantInboxRequest(request, 'view')).resolves.toEqual(
      {
        ok: true,
        binding,
        supabase,
        merchantId: MERCHANT_ID,
        canViewOrders: true,
      }
    );
    expect(mocks.getMerchantInboxBinding).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('authenticates the request itself so Bearer and cookie sessions both work', async () => {
    await resolveMerchantInboxRequest(request, 'view');
    expect(mocks.authenticate).toHaveBeenCalledWith(request);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      supabase,
      'user-1'
    );
  });

  it('rejects a signed-out caller before any merchant lookup', async () => {
    mocks.authenticate.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Not authenticated',
    });
    await expect(failure()).resolves.toMatchObject({
      status: 401,
      body: { code: 'unauthorized' },
      cache: 'private, no-store',
    });
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('rejects a user without a merchant', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(null);
    await expect(failure()).resolves.toMatchObject({
      status: 404,
      body: { code: 'merchant_not_found' },
    });
    expect(mocks.getMerchantInboxBinding).not.toHaveBeenCalled();
  });

  it('rejects staff without customer access before reading the binding', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(
      staff({ orders: { view: true } })
    );
    await expect(failure()).resolves.toMatchObject({
      status: 403,
      body: { code: 'forbidden' },
    });
    expect(mocks.getMerchantInboxBinding).not.toHaveBeenCalled();
  });

  it('lets view-only staff read but not act', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(
      staff({ customers: { view: true } })
    );
    await expect(
      resolveMerchantInboxRequest(request, 'view')
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(failure('edit')).resolves.toMatchObject({ status: 403 });
  });

  it('bugfix: tells the route whether the caller may see order details', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(
      staff({ customers: { view: true } })
    );
    await expect(
      resolveMerchantInboxRequest(request, 'view')
    ).resolves.toMatchObject({ ok: true, canViewOrders: false });

    mocks.getMerchantForApiRequest.mockResolvedValue(
      staff({ customers: { view: true }, orders: { view: true } })
    );
    await expect(
      resolveMerchantInboxRequest(request, 'view')
    ).resolves.toMatchObject({ ok: true, canViewOrders: true });
  });

  it('reports an unbound store without exposing configuration detail', async () => {
    mocks.getMerchantInboxBinding.mockReturnValue(null);
    await expect(failure()).resolves.toEqual({
      status: 404,
      body: {
        error: 'Messages are not set up for this store',
        code: 'inbox_unavailable',
      },
      cache: 'private, no-store',
    });
  });
});
