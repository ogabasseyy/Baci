import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsAutoDebitFundingContent } from './StartSavingsAutoDebitFundingContent';
import { createStartSavingsController } from './start-savings-controller.test-support';

const card = {
  id: 'card-1',
  label: 'Visa 4242',
  last4: '4242',
} as never;

function renderContent(change: Record<string, unknown> = {}) {
  const controller = createStartSavingsController({
    savedPaymentMethods: [card],
    handleAuthorizeSavingsCard: jest.fn(() => Promise.resolve()),
    ...change,
  });
  render(
    <StartSavingsAutoDebitFundingContent
      colors={Colors.light}
      controller={controller}
    />
  );
  return controller;
}

describe('StartSavingsAutoDebitFundingContent with PiggyVest off', () => {
  it('lets the customer pick a saved card and add a new one', () => {
    const controller = renderContent();
    fireEvent.press(screen.getByRole('button', { name: 'Select Visa 4242' }));
    expect(controller.setSelectedPaymentMethodId).toHaveBeenCalledWith(
      'card-1'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add savings card' }));
    expect(controller.handleAuthorizeSavingsCard).toHaveBeenCalled();
  });

  describe('bugfix: card choices stayed live while the plan was being created', () => {
    it('locks every card control until creation settles', () => {
      const controller = renderContent({ isSubmitting: true });
      fireEvent.press(screen.getByRole('button', { name: 'Select Visa 4242' }));
      fireEvent.press(screen.getByRole('button', { name: 'Add savings card' }));
      expect(controller.setSelectedPaymentMethodId).not.toHaveBeenCalled();
      expect(controller.handleAuthorizeSavingsCard).not.toHaveBeenCalled();
    });
  });
});
