import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsQuickAmounts } from './SavingsQuickAmounts';

const options = [
  { amount: 5000, label: '₦5,000' },
  { amount: 1000, label: 'Max', spokenLabel: 'all available' },
];

describe('SavingsQuickAmounts', () => {
  it('fills the chosen amount and marks it selected', () => {
    const onSelect = jest.fn();
    render(
      <SavingsQuickAmounts
        colors={Colors.light}
        disabled={false}
        onSelect={onSelect}
        options={options}
        selectedAmount={1000}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Use ₦1,000, all available' })
    ).toHaveAccessibilityState({ selected: true });
    const five = screen.getByRole('button', { name: 'Use ₦5,000' });
    expect(five).toHaveAccessibilityState({ selected: false });
    fireEvent.press(five);
    expect(onSelect).toHaveBeenCalledWith(5000);
  });

  // Walk 18: a selected Finish chip was a full-width red bar above the red
  // "Add" button, reading as two primary buttons.
  it('never fills a selected chip with the primary button colour', () => {
    render(
      <SavingsQuickAmounts
        colors={Colors.light}
        disabled={false}
        onSelect={jest.fn()}
        options={[{ amount: 1000, label: 'Finish', spokenLabel: 'reach goal' }]}
        selectedAmount={1000}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Use ₦1,000, reach goal' })
    ).not.toHaveStyle({ backgroundColor: Colors.light.primary });
  });

  it('cannot be used while a contribution is being added', () => {
    const onSelect = jest.fn();
    render(
      <SavingsQuickAmounts
        colors={Colors.dark}
        disabled
        onSelect={onSelect}
        options={options}
        selectedAmount={0}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Use ₦5,000' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing without options', () => {
    render(
      <SavingsQuickAmounts
        colors={Colors.dark}
        disabled={false}
        onSelect={jest.fn()}
        options={[]}
        selectedAmount={0}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  // Walk 17: "Finish" stayed bright red while "Adding…" was dimmed.
  it('dims every chip, the selected one too, while disabled', () => {
    render(
      <SavingsQuickAmounts
        colors={Colors.light}
        disabled
        onSelect={jest.fn()}
        options={options}
        selectedAmount={1000}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Use ₦1,000, all available' })
    ).toHaveStyle({ opacity: 0.5 });
    expect(screen.getByRole('button', { name: 'Use ₦5,000' })).toHaveStyle({
      opacity: 0.5,
    });
  });
});
