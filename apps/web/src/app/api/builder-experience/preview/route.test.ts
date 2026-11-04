// @vitest-environment node

import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: merchant.user ? { id: 'owner' } : null },
        error: null,
      }),
    },
  }),
}));
const merchant = vi.hoisted(() => ({ owner: true, user: true }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: async (
    _client: unknown,
    _user: string,
    options: { requestedMerchantId: string }
  ) => ({
    merchantId: options.requestedMerchantId,
    staffAccess: { isOwner: merchant.owner },
  }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));

import { installExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { GET, POST } from './route';

it('GET never launches; uninstalled POST503; installed POST calls owner-scoped runtime', async () => {
  const body = {
    merchantId: '10000000-0000-4000-8000-000000000001',
    buildId: '20000000-0000-4000-8000-000000000001',
    routeId: 'home',
  };
  const request = () =>
    new NextRequest('http://localhost/api/builder-experience/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  expect((await GET()).status).toBe(405);
  expect((await POST(request())).status).toBe(503);
  const createPreviewLaunch = vi.fn(async () => ({ launchRef: 'private-ref' }));
  const cleanup = installExperienceOwnerRuntime({ createPreviewLaunch });
  try {
    expect((await POST(request())).status).toBe(200);
    expect(createPreviewLaunch).toHaveBeenCalledOnce();
    merchant.owner = false;
    expect((await POST(request())).status).toBe(403);
    expect(createPreviewLaunch).toHaveBeenCalledOnce();
  } finally {
    merchant.owner = true;
    cleanup();
  }
});

it('denies staff status polling before querying private bindings', async () => {
  merchant.owner = false;
  try {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/builder-experience/preview?merchantId=10000000-0000-4000-8000-000000000001&bindingId=20000000-0000-4000-8000-000000000001'
      )
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ active: false });
  } finally {
    merchant.owner = true;
  }
});

it('authenticates malformed status requests before parsing their locator', async () => {
  merchant.user = false;
  try {
    expect((await GET()).status).toBe(403);
  } finally {
    merchant.user = true;
  }
});
