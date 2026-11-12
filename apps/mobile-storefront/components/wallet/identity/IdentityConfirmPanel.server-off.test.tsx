import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  confirmIdentityCode,
  sendIdentityCode,
} from '@/lib/wallet-identity-confirm-api';
import { IdentityConfirmPanel } from './IdentityConfirmPanel';

jest.mock('@/lib/wallet-identity-confirm-api', () => ({
  sendIdentityCode: jest.fn(),
  confirmIdentityCode: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', email: 'bassey@example.com' } }),
}));

const press = (name: string) =>
  fireEvent.press(screen.getByRole('button', { name }));

beforeEach(() => jest.resetAllMocks());

// The panel only uses the normal sign-in code endpoints and only after a tap,
// so opening it calls nothing whether or not the server has PiggyVest on.
describe('IdentityConfirmPanel', () => {
  it('asks first, sends on tap, and keeps Confirm grey until six digits', async () => {
    jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
    jest.mocked(confirmIdentityCode).mockResolvedValue(undefined);
    const onConfirmed = jest.fn();
    render(
      <IdentityConfirmPanel colors={Colors.light} onConfirmed={onConfirmed} />
    );
    expect(screen.getByText("Confirm it's you")).toBeTruthy();
    expect(sendIdentityCode).not.toHaveBeenCalled();
    await act(async () => press('Send code'));
    expect(screen.getByLabelText('Code, 0 of 6 digits entered')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveStyle({ backgroundColor: Colors.light.muted });
    for (const digit of '123456') press(digit);
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveStyle({
      backgroundColor: Colors.light.primary,
    });
    await act(async () => press('Confirm'));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('can send a new code', async () => {
    jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
    render(
      <IdentityConfirmPanel colors={Colors.light} onConfirmed={jest.fn()} />
    );
    await act(async () => press('Send code'));
    await act(async () => press('Send a new code'));
    expect(sendIdentityCode).toHaveBeenCalledTimes(2);
    expect(screen.getByText('We sent you a new code.')).toBeTruthy();
  });
});
