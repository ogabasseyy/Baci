import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { renderWalletSavingsSheetStep } from './render-wallet-savings-sheet-step';

jest.mock('./savings/SavingsVariantPickStep', () => ({
  SavingsVariantPickStep: () => {
    const { Text: MockText } = require('react-native');
    return <MockText>variant-pick</MockText>;
  },
}));
jest.mock('./savings/SavingsPhoneSwapStep', () => ({
  SavingsPhoneSwapStep: () => {
    const { Text: MockText } = require('react-native');
    return <MockText>phone-swap</MockText>;
  },
}));

const completed = {
  id: 'goal-1',
  status: 'completed',
  selection_unresolved: true,
  variant_resolution_options: [],
} as unknown as WalletActiveSavingsGoal;
const active = { id: 'goal-2', status: 'active' } as WalletActiveSavingsGoal;
const swap = (open: boolean) => ({ showSavingsDeviceSwap: open }) as never;

function renderStep(
  goal: WalletActiveSavingsGoal | null,
  showVariantPick: boolean,
  swapOpen: boolean
) {
  render(
    <>
      {renderWalletSavingsSheetStep({
        colors: Colors.light,
        goal,
        showVariantPick,
        onCloseVariantPick: jest.fn(),
        onResolveVariant: jest.fn(async () => true as const),
        swap: swap(swapOpen),
      })}
      <Text>end</Text>
    </>
  );
}

// Local view switching only: nothing here calls PiggyVest.
describe('server keeps PiggyVest off: savings sheet step', () => {
  it('shows the exact-phone picker for a completed goal still to choose', () => {
    renderStep(completed, true, false);
    expect(screen.getByText('variant-pick')).toBeOnTheScreen();
  });

  it('never shows the picker for a goal that is not completed', () => {
    renderStep(active, true, false);
    expect(screen.queryByText('variant-pick')).toBeNull();
  });

  it('shows Change phone when the swap is open', () => {
    renderStep(active, false, true);
    expect(screen.getByText('phone-swap')).toBeOnTheScreen();
  });

  it('returns null (so the sheet keeps its main view) without a goal or an open step', () => {
    const base = {
      colors: Colors.light,
      onCloseVariantPick: jest.fn(),
      onResolveVariant: jest.fn(async () => true as const),
    };
    expect(
      renderWalletSavingsSheetStep({
        ...base,
        goal: null,
        showVariantPick: true,
        swap: swap(true),
      })
    ).toBeNull();
    expect(
      renderWalletSavingsSheetStep({
        ...base,
        goal: active,
        showVariantPick: true,
        swap: swap(false),
      })
    ).toBeNull();
  });
});
