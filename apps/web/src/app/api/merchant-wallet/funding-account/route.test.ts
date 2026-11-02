import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';

const getUser = vi.fn();
const from = vi.fn();
const getAccount = vi.fn();
const requestAccount = vi.fn();
const checkCsrfProtection = vi.fn();
const authenticateApiRequest = vi.fn();
const getUserAccess = vi.fn();
vi.mock('@/lib/api-auth', async () => {
  const permissions = await vi.importActual<
    typeof import('@/lib/api-permissions')
  >('@/lib/api-permissions');
  return {
    authenticateApiRequest,
    getUserAccess,
    hasPermission: permissions.hasPermission,
  };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection }));
vi.mock('@/lib/merchant-wallet-payment-accounts', () => ({
  getMerchantWalletAccount: getAccount,
  requestMerchantWalletAccount: requestAccount,
}));
const { GET, POST } = await import('./route');
const getHandler = GET as unknown as (request: Request) => Promise<Response>;
const postHandler = POST as unknown as (request: Request) => Promise<Response>;
const merchantLookups: unknown[][] = [];
function ownerQuery(data: unknown, error: Error | null = null) {
  return {
    select: () => ({
      eq: (...args: unknown[]) => {
        merchantLookups.push(args);
        return { maybeSingle: async () => ({ data, error }) };
      },
    }),
  };
}
const owner: UserAccess = {
  merchantId: 'm1',
  role: 'owner',
  isOwner: true,
  isStaff: false,
  permissions: {},
};
function staff(permissions: UserAccess['permissions']): UserAccess {
  return {
    merchantId: 'm1',
    role: 'fulfillment',
    isOwner: false,
    isStaff: true,
    permissions,
  };
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/merchant-wallet/funding-account', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
const getRequest = new Request(
  'http://localhost/api/merchant-wallet/funding-account'
);
describe('funding account handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateApiRequest.mockResolvedValue({
      user: { id: 'u1', email: 'u@example.com' },
      error: null,
      supabase: { from },
    });
    from.mockReturnValue(
      ownerQuery({
        id: 'm1',
        business_name: 'Shop',
        email: 'merchant@example.com',
      })
    );
    checkCsrfProtection.mockResolvedValue({ valid: true });
    getUserAccess.mockResolvedValue(owner);
    merchantLookups.length = 0;
  });
  it('authenticates before parsing malformed JSON', async () => {
    authenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const r = await postHandler(
      new Request('http://x', { method: 'POST', body: '{' })
    );
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it('returns 400 for malformed JSON', async () => {
    const r = await postHandler(
      new Request('http://x', { method: 'POST', body: '{' })
    );
    expect(r.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(requestAccount).not.toHaveBeenCalled();
  });
  it('rejects invalid CSRF before merchant access, body parsing, or provider provisioning', async () => {
    checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const r = await postHandler(
      new Request('http://x', { method: 'POST', body: '{' })
    );
    expect(r.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(requestAccount).not.toHaveBeenCalled();
  });

  it('keeps valid bearer mobile funding requests supported', async () => {
    requestAccount.mockResolvedValue({ account: null, status: 'pending' });
    const bearerRequest = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ consent: true }),
      headers: {
        authorization: 'Bearer mobile-access-token',
        'content-type': 'application/json',
      },
    });
    const r = await postHandler(bearerRequest);
    expect(r.status).toBe(202);
    expect(authenticateApiRequest).toHaveBeenCalledWith(bearerRequest);
    expect(checkCsrfProtection).toHaveBeenCalledWith(expect.any(Request));
    expect(requestAccount).toHaveBeenCalledTimes(1);
  });
  it.each([
    undefined,
    false,
    'yes',
    null,
  ])('rejects invalid consent', async (consent) => {
    const r = await postHandler(req(consent === undefined ? {} : { consent }));
    expect(r.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
  it('returns 403 when the caller has no merchant access', async () => {
    getUserAccess.mockResolvedValue(null);
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(requestAccount).not.toHaveBeenCalled();
  });
  it('returns 403 for staff without orders.fulfill on GET and POST', async () => {
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, edit: true } })
    );
    expect((await getHandler(getRequest)).status).toBe(403);
    expect((await postHandler(req({ consent: true }))).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
    expect(requestAccount).not.toHaveBeenCalled();
  });
  it('returns 403 when the resolved merchant row is not visible', async () => {
    from.mockReturnValue(ownerQuery(null));
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(403);
    expect(requestAccount).not.toHaveBeenCalled();
  });
  it('lets orders.fulfill staff view the merchant funding account', async () => {
    getUserAccess.mockResolvedValue(staff({ orders: { fulfill: true } }));
    getAccount.mockResolvedValue({
      accountNumber: '1234567890',
      accountName: 'Shop',
      bankName: 'Bank',
      currency: 'NGN',
      status: 'active',
    });
    const r = await getHandler(getRequest);
    expect(r.status).toBe(200);
    expect(merchantLookups).toEqual([['id', 'm1']]);
    expect(getAccount).toHaveBeenCalledWith({ from }, 'm1');
  });
  it('opens the account for orders.fulfill staff with the business email', async () => {
    getUserAccess.mockResolvedValue(staff({ orders: { fulfill: true } }));
    requestAccount.mockResolvedValue({ account: null, status: 'pending' });
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(202);
    expect(requestAccount).toHaveBeenCalledWith(
      { from },
      { id: 'm1', email: 'merchant@example.com', firstName: 'Shop' }
    );
  });
  it('never registers the account under a staff email', async () => {
    getUserAccess.mockResolvedValue(staff({ orders: { fulfill: true } }));
    from.mockReturnValue(
      ownerQuery({ id: 'm1', business_name: 'Shop', email: null })
    );
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: 'Add a business email before opening a funding account.',
      code: 'MERCHANT_EMAIL_REQUIRED',
    });
    expect(requestAccount).not.toHaveBeenCalled();
  });
  it('falls back to the owner login email when the business email is empty', async () => {
    from.mockReturnValue(
      ownerQuery({ id: 'm1', business_name: 'Shop', email: '  ' })
    );
    requestAccount.mockResolvedValue({ account: null, status: 'pending' });
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(202);
    expect(requestAccount).toHaveBeenCalledWith(
      { from },
      { id: 'm1', email: 'u@example.com', firstName: 'Shop' }
    );
  });
  it('returns owner lookup error safely', async () => {
    from.mockReturnValue(ownerQuery(null, new Error('secret')));
    const r = await getHandler(getRequest);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Unable to load merchant' });
  });
  it('returns existing active account with safe fields', async () => {
    getAccount.mockResolvedValue({
      accountNumber: '1234567890',
      accountName: 'Shop',
      bankName: 'Bank',
      currency: 'NGN',
      status: 'active',
    });
    const r = await getHandler(getRequest);
    expect(await r.json()).toEqual({
      account: expect.objectContaining({
        accountNumber: '1234567890',
        status: 'active',
      }),
    });
  });
  it('returns null account while assignment is pending', async () => {
    requestAccount.mockResolvedValue({ account: null, status: 'pending' });
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ account: null, status: 'pending' });
  });
  it('returns active assignment immediately when helper finds one', async () => {
    requestAccount.mockResolvedValue({
      account: { accountNumber: '1234567890', status: 'active' },
      status: 'active',
    });
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(200);
  });
  it('maps provider failure to 502 and redacts body', async () => {
    requestAccount.mockRejectedValue(new Error('Paystack secret body'));
    const r = await postHandler(req({ consent: true }));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({
      error: 'Unable to start funding account assignment',
    });
  });
  it('uses the mobile-aware authenticator for funding requests', async () => {
    requestAccount.mockResolvedValue({ account: null, status: 'pending' });
    await postHandler(req({ consent: true }));
    expect(authenticateApiRequest).toHaveBeenCalledWith(expect.any(Request));
  });
});
