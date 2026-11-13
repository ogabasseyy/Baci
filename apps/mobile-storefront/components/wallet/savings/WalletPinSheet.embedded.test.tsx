import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { SavingsSheetContext } from '../SavingsSheetContext';
import { SavingsSheetPinHeightContext } from '../SavingsSheetPinHeightContext';
import { WalletPinSheet } from './WalletPinSheet';

jest.mock('@/lib/wallet-pin-api');
const mockSnapToPosition = jest.fn();
const mockSetPinHeight = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheet: () => ({
    snapToPosition: mockSnapToPosition,
    snapToIndex: jest.fn(),
  }),
}));

const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 100000,
};

function inSheet(open: typeof request | null) {
  return (
    <SavingsSheetContext.Provider value={true}>
      <SavingsSheetPinHeightContext.Provider value={mockSetPinHeight}>
        <WalletPinSheet
          colors={Colors.light}
          request={open}
          onProof={jest.fn()}
          onCancel={jest.fn()}
        />
      </SavingsSheetPinHeightContext.Provider>
    </SavingsSheetContext.Provider>
  );
}

function renderInSavingsSheet(open: typeof request | null) {
  return render(inSheet(open));
}

// Inside the Add to savings sheet the PIN step takes over that same sheet:
// no second sheet opens on top of it.
describe('PIN step inside the savings sheet', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fetchWalletPinStatus).mockResolvedValue({
      primary: true,
      hasPin: true,
      resetRequired: false,
      available: true,
    });
  });

  it('sizes the same sheet to the PIN step and goes back on close', async () => {
    const view = renderInSavingsSheet(request);
    expect(await screen.findByText('Enter your wallet PIN')).toBeOnTheScreen();
    // The sheet is sized to the measured PIN step, not opened to full height.
    fireEvent(screen.getByTestId('pin-step-content'), 'layout', {
      nativeEvent: { layout: { height: 600 } },
    });
    expect(mockSetPinHeight).toHaveBeenLastCalledWith(600);
    expect(mockSnapToPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
    view.rerender(inSheet(null));
    expect(screen.queryByText('Enter your wallet PIN')).toBeNull();
    expect(mockSetPinHeight).toHaveBeenLastCalledWith(0);
  });

  it('renders nothing without a PIN request', () => {
    renderInSavingsSheet(null);
    expect(screen.queryByText(/PIN/)).toBeNull();
    expect(mockSnapToPosition).not.toHaveBeenCalled();
  });
});
