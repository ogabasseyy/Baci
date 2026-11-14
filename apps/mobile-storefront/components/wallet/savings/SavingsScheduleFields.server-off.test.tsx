import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsScheduleFields } from './SavingsScheduleFields';
import { createStartSavingsController } from './start-savings-controller.test-support';

describe('SavingsScheduleFields with PiggyVest off', () => {
  it('changes the frequency', () => {
    const controller = createStartSavingsController();
    render(
      <SavingsScheduleFields colors={Colors.light} controller={controller} />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose weekly savings frequency' })
    );
    expect(controller.setFrequency).toHaveBeenCalledWith('weekly');
  });

  it('shows a round default debit time', () => {
    render(
      <SavingsScheduleFields
        colors={Colors.light}
        controller={createStartSavingsController({ preferredDebitTime: '' })}
      />
    );
    expect(screen.queryByText(/06:20|6:20/)).toBeNull();
  });
});
