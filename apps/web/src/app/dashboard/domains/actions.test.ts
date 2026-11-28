import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  requireMerchantFeatureAccess: vi.fn(),
  triggerDomainEdgeConfigSync: vi.fn(),
  updateDomainQuery: {
    eq: vi.fn(),
  },
  selectDomainQuery: {
    eq: vi.fn(),
    single: vi.fn(),
  },
  domainsTable: {
    select: vi.fn(),
    update: vi.fn(),
  },
  supabaseClient: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: mocks.revalidateMerchantFeed,
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: mocks.triggerDomainEdgeConfigSync,
}));

vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: (...args: unknown[]) => mocks.ensurePermission(...args),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mocks.requireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.supabaseClient),
}));

const { setPrimaryDomain } = await import('./actions');

describe('setPrimaryDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseClient.auth.getUser = mocks.getUser;
    mocks.supabaseClient.from.mockReturnValue(mocks.domainsTable);
    mocks.domainsTable.select.mockReturnValue(mocks.selectDomainQuery);
    mocks.domainsTable.update.mockReturnValue(mocks.updateDomainQuery);
    mocks.selectDomainQuery.eq.mockReturnValue(mocks.selectDomainQuery);
    mocks.selectDomainQuery.single.mockResolvedValue({
      data: { id: 'domain-1', status: 'active' },
      error: null,
    });
    mocks.updateDomainQuery.eq.mockResolvedValue({ error: null });
    mocks.supabaseClient.rpc.mockResolvedValue({
      data: { status: 'updated' },
      error: null,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.requireMerchantFeatureAccess.mockResolvedValue(null);
    mocks.ensurePermission.mockResolvedValue({
      merchant: { id: 'merchant-1' },
      staffAccess: { isOwner: true },
    });
  });

  it('returns unauthorized before permission or domain mutation when auth fails', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = await setPrimaryDomain('shop.example.com');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mocks.ensurePermission).not.toHaveBeenCalled();
    expect(mocks.domainsTable.update).not.toHaveBeenCalled();
  });

  it('sets an active domain as primary after settings edit authorization', async () => {
    const result = await setPrimaryDomain('shop.example.com');

    expect(result).toEqual({ success: true });
    expect(mocks.ensurePermission).toHaveBeenCalledWith('settings', 'edit');
    expect(mocks.requireMerchantFeatureAccess).toHaveBeenCalledWith(
      mocks.supabaseClient,
      'merchant-1',
      'custom_domain'
    );
    expect(mocks.supabaseClient.from).toHaveBeenCalledWith('domains');
    expect(mocks.selectDomainQuery.eq).toHaveBeenCalledWith(
      'domain',
      'shop.example.com'
    );
    expect(mocks.selectDomainQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(mocks.supabaseClient.rpc).toHaveBeenCalledWith(
      'set_merchant_primary_domain',
      { p_domain: 'shop.example.com' }
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/domains');
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
    expect(mocks.triggerDomainEdgeConfigSync).toHaveBeenCalled();
  });

  it('returns the upgrade error before mutating domains when custom domains are locked', async () => {
    mocks.requireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        { error: 'Custom domains require Baci Starter or higher' },
        { status: 402 }
      )
    );

    const result = await setPrimaryDomain('shop.example.com');

    expect(result).toEqual({
      success: false,
      error: 'Custom domains require Baci Starter or higher',
    });
    expect(mocks.domainsTable.select).not.toHaveBeenCalled();
    expect(mocks.domainsTable.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.revalidateMerchantFeed).not.toHaveBeenCalled();
  });
});
