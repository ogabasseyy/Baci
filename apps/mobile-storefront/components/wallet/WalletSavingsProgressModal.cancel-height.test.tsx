import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import Colors from '@/constants/Colors';
import type { GoalLifecycleStep } from './savings/goal-lifecycle-outcomes';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

let mockSetStep: (step: GoalLifecycleStep) => void = () => {};

jest.mock('./savings/use-in-sheet-goal-cancel', () => ({
  useInSheetGoalCancel: (goal: { id: string } | null) => {
    const { useState } = require('react');
    const [held, setHeld] = useState(null);
    const [step, setStep] = useState('review');
    mockSetStep = setStep;
    return {
      goal: held,
      kind: 'cancel',
      flow: {
        step,
        message: null,
        canStartAgain: false,
        needsSignIn: false,
        begin: async () => setStep('issuing'),
        retryPin: async () => {},
        checkAgain: async () => {},
        sheetProps: {},
      },
      start: () => setHeld(goal),
      keep: () => setHeld(null),
      closed: () => setHeld(null),
    };
  },
}));
jest.mock('./savings/GoalLifecycleEntry', () => ({
  GoalLifecycleEntry: ({ onCancel }: { onCancel: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" onPress={onCancel}>
        <Text>Open cancel review</Text>
      </Pressable>
    );
  },
}));
jest.mock('./savings/WalletPinSheet', () => ({ WalletPinSheet: () => null }));
jest.mock('./WalletSavingsFundingSection', () => ({
  WalletSavingsFundingSection: () => null,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

const goal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly' as const,
  current_amount: 110,
  principal_amount: 110,
  id: 'goal-1',
  maturity_date: '2027-12-01',
  source_mode: 'manual' as const,
  status: 'active' as const,
  target_amount: 250000,
  title: 'Phone',
};

const snapPoints = () =>
  screen.getByTestId('gorhom-bottom-sheet').props.snapPoints as unknown;
const scrollView = () => screen.UNSAFE_getAllByType(BottomSheetScrollView)[0];
// Handle and top padding (32) plus the minimum bottom padding (16).
const CHROME = 48;

// Simulator 2026-11-17 (iPhone, dark mode): "Cancel goal" opened the review
// tall, then shrank it to fit; "Cancel goal" in the review moved it again.
describe('bugfix: the cancel review jumped in height', () => {
  it('opens at its fitted height and holds it while cancelling', async () => {
    render(
      <WalletSavingsProgressModal
        addAmount="1000"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );
    // The Add to savings sheet, measured: header 40 + gap 16 + body 500.
    const header = screen
      .UNSAFE_getAllByType(View)
      .find((node) => typeof node.props.onLayout === 'function');
    if (!header) throw new Error('header not found');
    fireEvent(header, 'layout', {
      nativeEvent: { layout: { height: 40, width: 390, x: 0, y: 0 } },
    });
    fireEvent(scrollView(), 'contentSizeChange', 390, 500);
    const mainFit = [556 + CHROME];
    expect(snapPoints()).toEqual(mainFit);

    fireEvent.press(screen.getByText('Open cancel review'));

    // Unmeasured review: the height on screen stays, never the tall default.
    expect(screen.getByTestId('goal-cancel-step')).toBeOnTheScreen();
    expect(snapPoints()).toEqual(mainFit);
    fireEvent(scrollView(), 'contentSizeChange', 390, 330);
    const reviewFit = [330 + CHROME];
    expect(snapPoints()).toEqual(reviewFit);

    // "Cancel goal": the spinner row is shorter than the buttons it replaces.
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Cancel goal' }));
    });
    expect(screen.getByText('Cancelling your goal…')).toBeOnTheScreen();
    fireEvent(scrollView(), 'contentSizeChange', 390, 250);
    expect(snapPoints()).toEqual(reviewFit);

    // Settled: the sheet follows its content again.
    act(() => mockSetStep('done'));
    fireEvent(scrollView(), 'contentSizeChange', 390, 280);
    expect(snapPoints()).toEqual([280 + CHROME]);
  });
});
