import { act, render, screen, within } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useAuthStore } from '@/stores/auth-store';
import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));

// WalletPinSheet's own host, a ModalSheet (a native Modal), stands in for the
// PIN sheet, so the test checks real sheet-in-sheet nesting.
const pinPrompt = (
  <ModalSheet visible>
    <Text testID="wallet-pin-prompt">Enter wallet PIN</Text>
  </ModalSheet>
);

function modalsContainingPrompt() {
  return screen
    .UNSAFE_getAllByType(Modal)
    .filter(
      (modal) => within(modal).queryByTestId('wallet-pin-prompt') !== null
    );
}

// Regression: on iOS the PIN prompt could not open while the "Add to
// savings" sheet was showing, because both were sibling modals. Adding to a
// goal then hung on "Checking contribution…". The prompt must be mounted
// inside the savings sheet's own modal while that sheet is open.
describe('WalletContent PIN prompt placement', () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'pin-customer' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  afterEach(() => {
    act(() => useAuthStore.setState({ user: null, merchantId: null }));
  });

  it('nests the PIN modal inside the open savings sheet modal', () => {
    render(
      <WalletContent
        {...createWalletContentProps()}
        pinPrompt={pinPrompt}
        savingsContributionAmount="500"
        showSavingsProgress
      />
    );
    expect(screen.getAllByTestId('wallet-pin-prompt')).toHaveLength(1);
    // The PIN modal itself plus the savings sheet modal that hosts it.
    expect(modalsContainingPrompt()).toHaveLength(2);
  });

  it('mounts the PIN prompt once at the root when the savings sheet is closed', () => {
    render(
      <WalletContent
        {...createWalletContentProps()}
        pinPrompt={pinPrompt}
        showSavingsProgress={false}
      />
    );
    expect(screen.getAllByTestId('wallet-pin-prompt')).toHaveLength(1);
    // Only the PIN modal itself: it is not nested in any other modal.
    expect(modalsContainingPrompt()).toHaveLength(1);
  });

  it('keeps the PIN prompt mounted at the root when the goal disappears with the sheet open', () => {
    const props = createWalletContentProps();
    const view = render(
      <WalletContent
        {...props}
        pinPrompt={pinPrompt}
        savingsContributionAmount="500"
        showSavingsProgress
      />
    );
    expect(modalsContainingPrompt()).toHaveLength(2);
    view.rerender(
      <WalletContent
        {...props}
        activeSavingsGoal={null}
        pinPrompt={pinPrompt}
        savingsContributionAmount="500"
        showSavingsProgress
      />
    );
    expect(screen.getAllByTestId('wallet-pin-prompt')).toHaveLength(1);
    // Only the PIN modal itself: the savings sheet is gone, so it is at root.
    expect(modalsContainingPrompt()).toHaveLength(1);
  });
});
