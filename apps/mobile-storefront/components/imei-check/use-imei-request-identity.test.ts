import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useImeiRequestIdentity } from './use-imei-request-identity';

const mockAuth: { user: { id: string } | null } = { user: { id: 'user-1' } };
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

describe('useImeiRequestIdentity', () => {
  it('reuses an idempotency key for the same identifier and tier', () => {
    const createKey = jest
      .fn<() => string>()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2');
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));

    expect(result.current.get('blacklist', '490154203237518')).toBe('key-1');
    expect(result.current.get('blacklist', '490154203237518')).toBe('key-1');
    act(() => result.current.clear());
    expect(result.current.get('blacklist', '490154203237518')).toBe('key-2');
  });
});

describe('bugfix: a retry typed differently forked a retained request (Muse)', () => {
  it('treats spacing, dashes and case as the same identifier', () => {
    const createKey = jest.fn(() => 'key-1');
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));
    expect(result.current.get('basic', 'c02xl0abjgh5')).toBe('key-1');
    expect(result.current.retains('basic', ' C02X-L0AB-JGH5 ')).toBe(true);
    expect(result.current.get('basic', 'C02XL0ABJGH5')).toBe('key-1');
    expect(createKey).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: a store credit key replayed for another account (Muse)', () => {
  it('never retains or reuses a key across an account switch', () => {
    mockAuth.user = { id: 'user-1' };
    const createKey = jest
      .fn<() => string>()
      .mockReturnValueOnce('key-a')
      .mockReturnValueOnce('key-b');
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));
    expect(result.current.get('basic', '490154203237518')).toBe('key-a');
    mockAuth.user = { id: 'user-2' };
    expect(result.current.retains('basic', '490154203237518')).toBe(false);
    expect(result.current.get('basic', '490154203237518')).toBe('key-b');
    mockAuth.user = { id: 'user-1' };
  });
});
