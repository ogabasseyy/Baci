import { render, screen } from '@testing-library/react-native';
import { LegacyStartSavingsScreen } from './LegacyStartSavingsScreen';

const mockController = {
  isRefetching: false,
  refetch: jest.fn(),
  selectProduct: jest.fn(),
  pinSheetProps: { request: null, onProof: jest.fn(), onCancel: jest.fn() },
};
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockController,
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));
jest.mock('@/components/ui/AppKeyboardAwareScrollView', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { isVisible: () => false, dismiss: jest.fn() },
}));
const mockStatus = jest.fn();
jest.mock('@/lib/wallet-pin-api', () => ({
  fetchWalletPinStatus: () => mockStatus(),
}));

// With no PIN request (the server keeps PiggyVest off) the screen shows no PIN
// sheet and reads nothing from the PIN service.
describe('server keeps PiggyVest off', () => {
  it('shows no PIN UI and makes no PIN call', () => {
    render(<LegacyStartSavingsScreen />);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/wallet PIN/i)).toBeNull();
  });
});
