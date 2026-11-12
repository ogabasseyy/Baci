import { act, renderHook } from '@testing-library/react-native';
import {
  confirmIdentityCode,
  sendIdentityCode,
} from '@/lib/wallet-identity-confirm-api';
import { useIdentityConfirmation } from './use-identity-confirmation';

let mockUser: { id: string; email?: string } | null = {
  id: 'user-1',
  email: 'bassey@example.com',
};
jest.mock('@/lib/wallet-identity-confirm-api', () => ({
  sendIdentityCode: jest.fn(),
  confirmIdentityCode: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockUser }),
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: 'user-1', email: 'bassey@example.com' };
});

// Only the normal sign-in code endpoints, and only when the customer taps:
// nothing is called on open, whether or not the server has PiggyVest on.
describe('useIdentityConfirmation', () => {
  it('masks the email and calls nothing until asked', () => {
    const { result } = renderHook(() =>
      useIdentityConfirmation({ onConfirmed: jest.fn() })
    );
    expect(result.current.maskedEmail).toBe('ba***@example.com');
    expect(sendIdentityCode).not.toHaveBeenCalled();
  });

  it('sends, takes only six digits, confirms and hands back', async () => {
    jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
    jest.mocked(confirmIdentityCode).mockResolvedValue(undefined);
    const onConfirmed = jest.fn();
    const { result } = renderHook(() =>
      useIdentityConfirmation({ expectedUserId: 'user-1', onConfirmed })
    );
    await act(() => result.current.send());
    expect(result.current.sent).toBe(true);
    act(() => result.current.setCode('12a34567'));
    expect(result.current.code).toBe('123456');
    expect(result.current.ready).toBe(true);
    await act(() => result.current.verify());
    expect(confirmIdentityCode).toHaveBeenCalledWith({
      email: 'bassey@example.com',
      code: '123456',
      expectedUserId: 'user-1',
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.code).toBe('');
  });

  it('does not check a short code, and shows a refusal without handing back', async () => {
    jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
    jest
      .mocked(confirmIdentityCode)
      .mockRejectedValue(new Error('Invalid verification code.'));
    const onConfirmed = jest.fn();
    const { result } = renderHook(() =>
      useIdentityConfirmation({ onConfirmed })
    );
    await act(() => result.current.send());
    act(() => result.current.setCode('123'));
    await act(() => result.current.verify());
    expect(confirmIdentityCode).not.toHaveBeenCalled();
    act(() => result.current.setCode('123456'));
    await act(() => result.current.verify());
    expect(result.current.error).toBe('Invalid verification code.');
    expect(onConfirmed).not.toHaveBeenCalled();
    await act(() => result.current.send());
    expect(result.current.notice).toBe('We sent you a new code.');
  });

  it('explains instead of sending when the account has no email', async () => {
    mockUser = { id: 'user-1' };
    const { result } = renderHook(() =>
      useIdentityConfirmation({ onConfirmed: jest.fn() })
    );
    await act(() => result.current.send());
    expect(sendIdentityCode).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/could not find an email/);
  });
});
