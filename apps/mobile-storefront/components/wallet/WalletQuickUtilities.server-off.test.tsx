// Server-off release-gate test: PiggyVest stays off server-side; the
// component must render and behave exactly as in production.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletQuickUtilities } from './WalletQuickUtilities';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

describe('WalletQuickUtilities (server off)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders utility pills and routes each button to its utility screen', () => {
    render(<WalletQuickUtilities accentColor="#2563EB" />);

    expect(screen.queryByText('Quick Utilities')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Buy Airtime' }));
    fireEvent.press(screen.getByRole('button', { name: 'Buy Data' }));
    fireEvent.press(screen.getByRole('button', { name: 'Pay Power Bill' }));
    fireEvent.press(screen.getByRole('button', { name: 'Pay TV Bill' }));
    fireEvent.press(screen.getByRole('button', { name: 'Pay Gaming Bill' }));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/utilities/airtime');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/utilities/data');
    expect(mockPush).toHaveBeenNthCalledWith(3, '/utilities/power');
    expect(mockPush).toHaveBeenNthCalledWith(4, '/utilities/tv');
    expect(mockPush).toHaveBeenNthCalledWith(5, '/utilities/gaming');
  });
});
