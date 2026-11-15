import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsModals } from './StartSavingsModals';
import { createStartSavingsController } from './start-savings-controller.test-support';

describe('StartSavingsModals with PiggyVest off', () => {
  it('shows nothing until the review opens', () => {
    render(
      <StartSavingsModals
        colors={Colors.light}
        controller={createStartSavingsController()}
      />
    );
    expect(screen.queryByText('Check your plan')).toBeNull();
  });

  it('confirms the plan in the same sheet, with no separate payment step', () => {
    render(
      <StartSavingsModals
        colors={Colors.light}
        controller={createStartSavingsController({ showSuccessModal: true })}
      />
    );
    expect(screen.getByText('Your plan is set')).toBeOnTheScreen();
    expect(screen.queryByText('Payment Methods')).toBeNull();
  });
});
