import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsPreviewModal } from './StartSavingsPreviewModal';
import type { StartSavingsController } from './start-savings-controller.types';

describe('savings preview display', () => {
  it('reviews the plan in one step before creating it', () => {
    const setShowPreviewModal = jest.fn();
    const setShowFundingModal = jest.fn();
    const handleFundingContinue = jest.fn(() => Promise.resolve());
    const controller = {
      showPreviewModal: true,
      selectedProduct: { name: 'Test device' },
      targetValue: 100,
      contributionValue: 25,
      frequency: 'weekly',
      sourceMode: 'manual',
      primaryWallet: false,
      effectiveInitialContribution: 0,
      startDate: '2026-09-22',
      maturityDate: '2026-10-13',
      setShowPreviewModal,
      setShowFundingModal,
      handleFundingContinue,
    } as unknown as StartSavingsController;

    render(
      <StartSavingsPreviewModal colors={Colors.light} controller={controller} />
    );

    expect(screen.getByText('Check your plan')).toBeOnTheScreen();
    expect(screen.getByText('Test device')).toBeOnTheScreen();
    expect(screen.getByText('₦25 a week')).toBeOnTheScreen();
    expect(screen.getByText('13 October 2026')).toBeOnTheScreen();
    expect(screen.queryByText('Head start')).toBeNull();
    expect(screen.queryByText('Earns interest')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Create my plan' }));
    expect(handleFundingContinue).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Edit plan' }));
    expect(setShowPreviewModal).toHaveBeenCalledWith(false);
    expect(setShowFundingModal).toHaveBeenCalledWith(false);
  });
});
