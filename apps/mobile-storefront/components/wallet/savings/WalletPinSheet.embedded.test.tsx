import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { SavingsSheetContext } from '../SavingsSheetContext';
import { WalletPinSheet } from './WalletPinSheet';

jest.mock('@/lib/wallet-pin-api');
const mockSnapToPosition = jest.fn();
const mockSnapToIndex = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheet: () => ({
    snapToPosition: mockSnapToPosition,
    snapToIndex: mockSnapToIndex,
  }),
}));

const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 100000,
};

function renderInSavingsSheet(open: typeof request | null) {
  return render(
    <SavingsSheetContext.Provider value={true}>
      <WalletPinSheet
        colors={Colors.light}
        request={open}
        onProof={jest.fn()}
        onCancel={jest.fn()}
      />
    </SavingsSheetContext.Provider>
  );
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
    expect(mockSnapToPosition).toHaveBeenLastCalledWith(672);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
    view.rerender(
      <SavingsSheetContext.Provider value={true}>
        <WalletPinSheet
          colors={Colors.light}
          request={null}
          onProof={jest.fn()}
          onCancel={jest.fn()}
        />
      </SavingsSheetContext.Provider>
    );
    expect(screen.queryByText('Enter your wallet PIN')).toBeNull();
    expect(mockSnapToIndex).toHaveBeenCalledWith(0);
  });

  it('renders nothing without a PIN request', () => {
    renderInSavingsSheet(null);
    expect(screen.queryByText(/PIN/)).toBeNull();
    expect(mockSnapToPosition).not.toHaveBeenCalled();
  });
});
