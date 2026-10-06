import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsPreviewModal } from './StartSavingsPreviewModal';
import type { StartSavingsController } from './start-savings-controller.types';

describe('savings preview display', () => {
  it('shows the plan target and timeline before funding', () => {
    const setShowPreviewModal = jest.fn();
    const setShowFundingModal = jest.fn();
    const controller = {
      showPreviewModal: true,
      selectedProduct: { name: 'Test device' },
      targetValue: 100,
      contributionValue: 25,
      frequency: 'weekly',
      sourceMode: 'manual',
      effectiveInitialContribution: 25,
      maturityDate: '2026-10-13',
      setShowPreviewModal,
      setShowFundingModal,
    } as unknown as StartSavingsController;

    render(
      <StartSavingsPreviewModal colors={Colors.light} controller={controller} />
    );

    expect(screen.getByText('3 weeks')).toBeOnTheScreen();
    expect(screen.getByText('13 October 2026')).toBeOnTheScreen();
    expect(screen.getByText('Your savings plan')).toBeOnTheScreen();
    expect(screen.getByText('Plan target')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose savings funding option' })
    );
    expect(setShowPreviewModal).toHaveBeenCalledWith(false);
    expect(setShowFundingModal).toHaveBeenCalledWith(true);
  });
});
