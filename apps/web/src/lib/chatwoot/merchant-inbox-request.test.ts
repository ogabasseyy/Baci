import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  getMerchantInboxBinding: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mocks.getUser } })),
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

import { resolveMerchantInboxRequest } from './merchant-inbox-request';

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
  const result = await resolveMerchantInboxRequest(action);
  if (result.ok) throw new Error('expected a failure');
  return {
    status: result.response.status,
    body: await result.response.json(),
    cache: result.response.headers.get('cache-control'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.getMerchantForApiRequest.mockResolvedValue(owner());
  mocks.getMerchantInboxBinding.mockReturnValue(binding);
});

describe('resolveMerchantInboxRequest', () => {
  it('returns the binding of the session merchant for an owner', async () => {
    await expect(resolveMerchantInboxRequest('view')).resolves.toEqual({
      ok: true,
      binding,
    });
    expect(mocks.getMerchantInboxBinding).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('rejects a signed-out caller before any merchant lookup', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
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
    await expect(resolveMerchantInboxRequest('view')).resolves.toMatchObject({
      ok: true,
    });
    await expect(failure('edit')).resolves.toMatchObject({ status: 403 });
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
