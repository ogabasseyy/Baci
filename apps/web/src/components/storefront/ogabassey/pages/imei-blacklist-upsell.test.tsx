import { IMEI_SERVICE_TIERS, type ImeiDeviceCategory } from '@baci/shared/imei';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
  useOptionalCustomerAuth: () => ({ customer: { id: mocks.customerId } }),
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
    imei: '352313505010646',
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

describe('blacklist result upsell', () => {
  beforeEach(() => {
    mocks.available = true;
    mocks.customerId = 'upsell-customer';
    mocks.device = 'smartphone';
    localStorage.clear();
    mocks.check.mockReset().mockResolvedValue(success());
    mocks.poll.mockReset();
  });

  it('runs the priced blacklist check for the report IMEI only after clicking', async () => {
    await start();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    mocks.check.mockResolvedValue(
      success({ ...result, blacklistStatus: 'Clean' })
    );
    fireEvent.click(upsell());
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
    expect(mocks.check.mock.calls[1]).toEqual([
      result.imei,
      'blacklist',
      700,
      expect.any(String),
      'ogabassey',
      'smartphone',
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /check blacklist status/i })
      ).toBeNull()
    );
    expect(screen.getByText('Blacklist Status')).toBeInTheDocument();
  });

  it('keeps the report visible and blocks duplicate clicks while submitting', async () => {
    await start();
    mocks.check.mockReturnValue(new Promise(() => {}));
    const button = upsell();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('heading', { name: result.device })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /checking blacklist/i })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /check another device/i })
    ).toBeDisabled();
  });

  it('shows wallet funding on the report and retains the same identity for an uncertain retry', async () => {
    await start();
    mocks.check.mockResolvedValue({
      ...success(),
      result: null,
      error: 'Network error',
      keepRequestIdentity: true,
    });
    fireEvent.click(upsell());
    await screen.findByRole('alert');
    fireEvent.click(upsell());
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(3));
    expect(mocks.check.mock.calls[2][3]).toBe(mocks.check.mock.calls[1][3]);
    mocks.check.mockResolvedValue({
      ...success(),
      result: null,
      error: 'Insufficient wallet balance',
      needsWalletFunding: true,
    });
    fireEvent.click(upsell());
    expect(
      await screen.findByRole('link', { name: 'Fund wallet' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: result.device })
    ).toBeInTheDocument();
  });

  it('does not offer unavailable or already-known blacklist checks', async () => {
    mocks.available = false;
    await start();
    expect(
      screen.queryByRole('button', { name: /check blacklist status/i })
    ).toBeNull();
  });

  it.each([
    'Clean',
    'Blacklisted',
    'Not reported stolen',
  ])('does not sell another blacklist check for %s evidence', async (blacklistStatus) => {
    mocks.check.mockResolvedValue(success({ ...result, blacklistStatus }));
    await start();
    expect(
      screen.queryByRole('button', { name: /check blacklist status/i })
    ).toBeNull();
  });

  it('polls a pending upsell without another paid submission', async () => {
    await start();
    mocks.check.mockResolvedValue({
      ...success(),
      result: null,
      pending: { lookupId: 'lookup-2', pollAfterMs: 0 },
      keepRequestIdentity: true,
    });
    mocks.poll.mockResolvedValue({
      kind: 'complete',
      lookupId: 'lookup-2',
      result: { ...result, blacklistStatus: 'Clean' },
    });
    fireEvent.click(upsell());
    await screen.findByText('Blacklist Status');
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(mocks.poll).toHaveBeenCalledWith('lookup-2', 'ogabassey');
    expect(
      screen.queryByRole('button', { name: /check blacklist status/i })
    ).toBeNull();
  });

  it('offers the phone report blacklist check after the picker switches to a tablet in flight', async () => {
    let finish: ((value: ReturnType<typeof success>) => void) | undefined;
    mocks.check.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = render(<OgabasseyImeiChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'Run SIM Lock' }));
    mocks.device = 'tablet';
    view.rerender(<OgabasseyImeiChecker />);
    await act(async () => {
      finish?.(success());
    });
    expect(upsell()).toBeEnabled();
    fireEvent.click(upsell());
    expect(mocks.check.mock.calls[1]).toEqual([
      result.imei,
      'blacklist',
      700,
      expect.any(String),
      'ogabassey',
      'smartphone',
    ]);
  });

  it('allows a fresh check after a pending lookup is cleared by an account change', async () => {
    const view = await start();
    mocks.check.mockResolvedValue({
      ...success(),
      result: null,
      pending: { lookupId: 'lookup-2', pollAfterMs: 60_000 },
      keepRequestIdentity: true,
    });
    fireEvent.click(upsell());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /checking blacklist/i })
      ).toBeDisabled()
    );
    mocks.customerId = 'another-customer';
    view.rerender(<OgabasseyImeiChecker />);
    await waitFor(() => expect(upsell()).toBeEnabled());
    mocks.check.mockResolvedValue(
      success({ ...result, blacklistStatus: 'Clean' })
    );
    fireEvent.click(upsell());
    await screen.findByText('Blacklist Status');
    expect(mocks.check).toHaveBeenCalledTimes(3);
    expect(mocks.check.mock.calls[2][3]).not.toBe(mocks.check.mock.calls[1][3]);
  });
});
