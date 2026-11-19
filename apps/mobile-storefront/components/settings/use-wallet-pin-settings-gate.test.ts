import { act, renderHook, waitFor } from '@testing-library/react-native';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { useWalletPinSettingsGate } from './use-wallet-pin-settings-gate';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
jest.mock('@/lib/wallet-pin-api', () => ({ fetchWalletPinStatus: jest.fn() }));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'cfg-merchant' } }));

let mockAuth: { user: { id: string } | null; merchantId: string | null } = {
  user: { id: 'user-1' },
  merchantId: 'merchant-1',
};
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuth),
}));

const read = piggyvestPrimaryWalletApi.read as jest.Mock;
const status = fetchWalletPinStatus as jest.Mock;
const READY = {
  provisioningStatus: 'ready',
  account: { accountNumber: '1' },
  requiresConsent: false,
};
const PIN = {
  primary: true,
  hasPin: true,
  resetRequired: false,
  available: true,
};

function mount() {
  return renderHook(() => useWalletPinSettingsGate());
}

describe('useWalletPinSettingsGate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAuth = { user: { id: 'user-1' }, merchantId: 'merchant-1' };
  });

  it('is ready only when the snapshot is ready and the PIN status is primary and available', async () => {
    read.mockResolvedValue(READY);
    status.mockResolvedValue(PIN);
    const { result } = mount();
    expect(result.current.state).toBe('checking');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.status).toEqual(PIN);
    expect(read).toHaveBeenCalledWith('merchant-1', 'user-1');
    expect(status).toHaveBeenCalledWith('user-1');
  });

  it.each([
    ['pending snapshot', { provisioningStatus: 'pending', account: null }, PIN],
    [
      'ready without account',
      { provisioningStatus: 'ready', account: null },
      PIN,
    ],
    ['primary false', READY, { ...PIN, primary: false }],
    ['available false', READY, { ...PIN, available: false }],
  ])('is off for %s', async (_l, snap, pin) => {
    read.mockResolvedValue(snap);
    status.mockResolvedValue(pin);
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe('off'));
    expect(result.current.status).toBeNull();
  });

  it('is off when the snapshot rejects with PIGGYVEST_NOT_READY', async () => {
    read.mockRejectedValue(
      Object.assign(new Error('not ready'), { code: 'PIGGYVEST_NOT_READY' })
    );
    status.mockResolvedValue(PIN);
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe('off'));
  });

  it('is off when the status call rejects', async () => {
    read.mockResolvedValue(READY);
    status.mockRejectedValue(new Error('boom'));
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe('off'));
  });

  it('is off and calls nothing without a signed-in user', () => {
    mockAuth = { user: null, merchantId: null };
    const { result } = mount();
    expect(result.current.state).toBe('off');
    expect(read).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('falls back to the configured merchant id', async () => {
    mockAuth = { user: { id: 'user-1' }, merchantId: '  ' };
    read.mockResolvedValue(READY);
    status.mockResolvedValue(PIN);
    mount();
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith('cfg-merchant', 'user-1')
    );
  });

  it('discards a late answer after an account switch', async () => {
    let releaseFirst: (v: unknown) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        })
    );
    status.mockResolvedValue({ ...PIN, hasPin: false });
    const { result, rerender } = mount();
    mockAuth = { user: { id: 'user-2' }, merchantId: 'merchant-1' };
    read.mockResolvedValueOnce(READY);
    status.mockResolvedValue({ ...PIN, hasPin: true });
    rerender({});
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.status?.hasPin).toBe(true);
    await act(async () => {
      releaseFirst(READY);
    });
    expect(result.current.status?.hasPin).toBe(true);
  });

  it('refresh re-reads the status without dropping back to checking', async () => {
    read.mockResolvedValue(READY);
    status.mockResolvedValue({ ...PIN, hasPin: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe('ready'));
    status.mockResolvedValue(PIN);
    act(() => result.current.refresh());
    expect(result.current.state).toBe('ready');
    await waitFor(() => expect(result.current.status?.hasPin).toBe(true));
  });
});
