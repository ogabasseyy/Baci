import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiServiceDetailsSheet } from './imei-service-details-sheet';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

// The sheet borrows the savings sheet's look only; with the server keeping
// PiggyVest off it explains a check and lets the customer choose it, as for
// every customer.
describe('ImeiServiceDetailsSheet with the server keeping PiggyVest off', () => {
  it('explains the check and chooses it', () => {
    const onChoose = jest.fn();
    render(
      <ImeiServiceDetailsSheet
        colors={Colors.light}
        tier={IMEI_SERVICE_TIERS.blacklist}
        onChoose={onChoose}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Is it reported stolen?')).toBeOnTheScreen();
    expect(screen.getByText('Blacklist Status')).toBeOnTheScreen();
    expect(screen.queryByText(/PiggyVest|savings/i)).toBeNull();
    fireEvent.press(screen.getByLabelText('Choose Stolen Check'));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while no check is open', () => {
    render(
      <ImeiServiceDetailsSheet
        colors={Colors.light}
        tier={null}
        onChoose={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByRole('header')).toBeNull();
  });
});
