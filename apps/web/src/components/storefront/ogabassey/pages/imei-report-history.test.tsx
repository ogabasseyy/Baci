import { IMEI_SERVICE_TIERS, type ImeiDeviceCategory } from '@baci/shared/imei';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyImeiChecker } from './imei-checker';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  poll: vi.fn(),
  available: true,
  customerId: 'upsell-customer',
  device: 'smartphone' as ImeiDeviceCategory,
}));
vi.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: mocks.available ? ['blacklist'] : [],
    loading: false,
    failed: false,
  }),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => ({ customer: { id: mocks.customerId }, user: { id: '11111111-1111-4111-8111-111111111111' }, isLoading: false }),
}));
vi.mock('./imei-checker-request', () => ({
  performImeiCheck: mocks.check,
  pollImeiCheck: mocks.poll,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} href={String(href)}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'ogabassey' }, basePath: '' }),
}));
vi.mock('./use-imei-tier-selection', () => ({
  useImeiTierSelection: () => ({
    brand: 'apple',
    device: mocks.device,
    imei: '490154203237518',
    selectedTier: 'simLock',
    currentTier: IMEI_SERVICE_TIERS.simLock,
    identifier: 'imei',
    displayedTierKeys:
      mocks.available && mocks.device === 'smartphone'
        ? ['simLock', 'blacklist']
        : ['simLock'],
    onClearImei: vi.fn(),
  }),
}));
vi.mock('./imei-checker-entry', () => ({
  OgabasseyImeiEntry: ({ onCheck }: { onCheck: React.FormEventHandler }) => (
    <form onSubmit={onCheck}>
      <button type="submit">Run SIM Lock</button>
    </form>
  ),
}));
vi.mock('./imei-checker-shell', () => ({
  OgabasseyImeiCheckerShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock('./imei-remediation-offer', () => ({
  ImeiRemediationOffer: () => null,
}));

const result = {
  imei: '354442067957452',
  device: 'iPhone 17 Pro Max',
  status: 'Unknown',
  modelNumber: '',
  icloud: 'Unknown',
  icloudLock: 'Unknown',
  carrier: 'Unknown',
  deviceImage: '',
  deviceType: 'apple',
  simLock: 'Unlocked',
  blacklistStatus: 'Unknown',
  score: 100,
  verdict: 'Blacklist status was not checked.',
  verdictType: 'caution',
};
const success = (data = result) => ({
  result: data,
  lookupId: 'lookup-1',
  error: null,
  pending: null,
  needsSignIn: false,
  needsWalletFunding: false,
  keepRequestIdentity: false,
});
const upsell = () =>
  screen.getByRole('button', { name: 'Check blacklist status · ₦700' });
async function start() {
  const view = render(<OgabasseyImeiChecker />);
  fireEvent.click(screen.getByRole('button', { name: 'Run SIM Lock' }));
  await screen.findByRole('heading', { name: 'iPhone 17 Pro Max' });
  return view;
}

describe('completed report reopening', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, fn: () => unknown) => fn() } });
    mocks.check.mockReset();
    mocks.poll.mockReset();
    mocks.available = true;
  });
  it('loads the saved SIM Lock report with GET and offers the upsell without a paid POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        reports: [
          {
            lookupId: '11111111-1111-4111-8111-111111111111',
            createdAt: '2026-10-31T00:00:00Z',
            tier: 'simLock',
            device: 'smartphone',
            result,
          },
        ],
        hasMore: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<OgabasseyImeiChecker />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'My completed reports' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Open SIM Lock report for/ })
    );
    expect(
      await screen.findByRole('heading', { name: 'iPhone 17 Pro Max' })
    ).toBeVisible();
    expect(upsell()).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/reports?'),
      expect.objectContaining({ method: 'GET' })
    );
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

it('hides an opened report immediately when the signed-in customer changes', async () => {
  mocks.customerId = 'customer-a';
  mocks.check.mockResolvedValue(success());
  const view = await start();
  mocks.customerId = 'customer-b';
  view.rerender(<OgabasseyImeiChecker />);
  expect(
    screen.queryByRole('heading', { name: 'iPhone 17 Pro Max' })
  ).toBeNull();
});

it('keeps the same checkout key when a timed-out follow-up is retried after reopening history', async () => {
  mocks.customerId = 'reopen-customer';
  mocks.available = true;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () =>
      Response.json({
        reports: [
          {
            lookupId: '11111111-1111-4111-8111-111111111111',
            createdAt: '2026-10-31T00:00:00Z',
            tier: 'simLock',
            device: 'smartphone',
            result,
          },
        ],
        hasMore: false,
      })
    )
  );
  render(<OgabasseyImeiChecker />);
  fireEvent.click(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Open SIM Lock report for/ })
  );
  mocks.check.mockReset().mockResolvedValueOnce({
    ...success(),
    result: null,
    error: 'Network error',
    keepRequestIdentity: true,
  });
  fireEvent.click(upsell());
  await screen.findByText('Network error');
  const key = mocks.check.mock.calls[0][3];
  fireEvent.click(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Open SIM Lock report for/ })
  );
  mocks.check.mockResolvedValue(
    success({ ...result, blacklistStatus: 'Clean' })
  );
  fireEvent.click(upsell());
  await screen.findByText('Blacklist Status');
  expect(mocks.check.mock.calls[1][3]).toBe(key);
  vi.unstubAllGlobals();
});
