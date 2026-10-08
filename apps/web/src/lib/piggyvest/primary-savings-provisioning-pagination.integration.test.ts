import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from './primary-savings-provisioning.test-support';
import { runPrimarySavingsProvisioning } from './primary-savings-provisioning-runtime';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  prepare: vi.fn(),
  record: vi.fn(),
  enroll: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-savings-provisioning-store', () => ({
  createPrimarySavingsProvisioningStore: () => mocks,
}));
vi.mock('./primary-savings-provisioning-executor', () => ({
  createPrimarySavingsProvisioningExecutor: () => vi.fn(),
}));
const walletName = `baci-save:${provisioningFixture.scope.integrationId}:${provisioningFixture.goalId}`;
const target = {
  id: 'destination-with-hyphens',
  name: walletName,
  status: 'active',
};
const firstPage = Array.from({ length: 100 }, (_unused, index) => ({
  id: `other-${index}`,
  name: 'unrelated',
  status: 'active',
}));
let secondPage: unknown;
let pageCursor: string | null;
let omitPageInfo: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({
    status: 'pending',
    claimToken: null,
    providerCustomerId: 'customer-with-hyphens',
    primaryWalletId: 'primary',
    providerWalletId: target.id,
    walletName,
    interestAccepted: true,
  });
  mocks.enroll.mockResolvedValue(true);
  secondPage = [target];
  pageCursor = 'cursor-one';
  omitPageInfo = false;
  fetchMock = vi.fn(async (input: string, options: RequestInit) => {
    expect(options.method).toBe('GET');
    const url = new URL(input);
    let data: unknown;
    if (url.pathname === '/api/v1/wallet/api/wallet-type') {
      expect(url.searchParams.get('customer_id')).toBe('customer-with-hyphens');
      data = {
        paginatedPayload: {
          edges: url.searchParams.has('cursor') ? secondPage : firstPage,
          pageInfo: omitPageInfo
            ? undefined
            : url.searchParams.has('cursor')
              ? { hasNextPage: false, endCursor: pageCursor }
              : { hasNextPage: true, endCursor: 'cursor-one' },
        },
      };
    } else if (url.pathname.endsWith('/accounts')) {
      data = [
        {
          account_number: '0123456789',
          account_name: 'Synthetic',
          bank_name: 'Synthetic Bank',
          paypoint_name: null,
          paypoint_id: null,
        },
      ];
    } else {
      expect(url.pathname).toBe(`/api/v1/wallet/${target.id}`);
      data = {
        ...target,
        api_customer_id: 'customer-with-hyphens',
        business_id: 'business',
        currency: 'NGN',
        type: 'api',
        balance: 0,
        withdrawal_count: 0,
        creation_interest_rate: 0,
        current_interest_rate: 0,
      };
    }
    return Response.json({
      status: true,
      message: 'Synthetic provider fixture',
      data,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  firstPage[0] = { id: 'other-0', name: 'unrelated', status: 'active' };
});

function recover() {
  return runPrimarySavingsProvisioning({
    configuration: provisioningFixture.configuration,
    scope: provisioningFixture.scope,
    goalId: provisioningFixture.goalId,
    mode: 'recover',
  });
}
it('recovers the exact owned wallet on the second page through the real runtime and provider transport', async () => {
  pageCursor = 'cursor-two';
  const result = await recover();
  expect(result.status).toBe('ready');
  expect(result.accounts).toEqual([
    {
      accountNumber: '0123456789',
      accountName: 'Synthetic',
      bankName: 'Synthetic Bank',
    },
  ]);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.enroll).toHaveBeenCalledWith(
    provisioningFixture.goalId,
    expect.objectContaining({
      providerWalletId: target.id,
      providerCustomerId: 'customer-with-hyphens',
    })
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
it('rejects ambiguous matching names across pages instead of adopting the first candidate', async () => {
  firstPage[0] = target;
  secondPage = [{ ...target, id: 'other-owned-wallet' }];
  pageCursor = 'cursor-two';
  try {
    expect((await recover()).status).toBe('conflict');
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    firstPage[0] = { id: 'other-0', name: 'unrelated', status: 'active' };
  }
});
it('keeps repeated cursors pending even when the partial list contains an exact match', async () => {
  firstPage[0] = target;
  secondPage = [{ id: 'last-other', name: 'unrelated', status: 'active' }];
  expect((await recover()).status).toBe('pending');
  expect(mocks.enroll).not.toHaveBeenCalled();
});
it('keeps an invalid later page pending and does not expose account instructions', async () => {
  firstPage[0] = target;
  secondPage = undefined;
  const result = await recover();
  expect(result.status).toBe('pending');
  expect(result.accounts).toEqual([]);
  expect(mocks.enroll).not.toHaveBeenCalled();
});
it('keeps a matching partial list without completeness metadata pending', async () => {
  firstPage[0] = target;
  omitPageInfo = true;
  const result = await recover();
  expect(result.status).toBe('pending');
  expect(result.accounts).toEqual([]);
  expect(mocks.enroll).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
