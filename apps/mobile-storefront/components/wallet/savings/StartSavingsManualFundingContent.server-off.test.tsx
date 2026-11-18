import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsManualFundingContent } from './StartSavingsManualFundingContent';
import { createStartSavingsController } from './start-savings-controller.test-support';

function renderContent(change: Record<string, unknown> = {}) {
  const controller = createStartSavingsController(change);
  render(
    <StartSavingsManualFundingContent
      colors={Colors.light}
      controller={controller}
    />
  );
  return controller;
}

describe('StartSavingsManualFundingContent with PiggyVest off', () => {
  it('lets the customer choose how to pay the head start', () => {
    const controller = renderContent();
    fireEvent.press(
      screen.getByRole('button', { name: 'Pay with bank transfer' })
    );
    expect(controller.setSelectedFundingOption).toHaveBeenCalledWith(
      'bank_transfer'
    );
  });

  describe('bugfix: the head-start choice could change while the plan was being created', () => {
    it('locks both choices until creation settles', () => {
      const controller = renderContent({ isSubmitting: true });
      fireEvent.press(
        screen.getByRole('button', { name: 'Pay with bank transfer' })
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Pay with wallet balance' })
      );
      expect(controller.setSelectedFundingOption).not.toHaveBeenCalled();
    });
  });
});
