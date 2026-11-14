import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors, { BRAND } from '@/constants/Colors';
import { SavingsChoiceCards } from './SavingsChoiceCards';

const OPTIONS = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
] as const;

describe('SavingsChoiceCards with PiggyVest off', () => {
  it('fills the chosen card in brand red and marks it selected', () => {
    render(
      <SavingsChoiceCards
        accessibilityLabel="Head start"
        colors={Colors.light}
        options={OPTIONS}
        selected={true}
        onSelect={jest.fn()}
      />
    );
    const yes = screen.getByRole('radio', { name: 'Yes' });
    expect(yes).toBeSelected();
    expect(StyleSheet.flatten(yes.props.style).backgroundColor).toBe(
      BRAND.primary
    );
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeSelected();
  });

  it('reports the tapped answer and leaves both plain when nothing is chosen', () => {
    const onSelect = jest.fn();
    render(
      <SavingsChoiceCards
        accessibilityLabel="Head start"
        colors={Colors.light}
        options={OPTIONS}
        selected={null}
        onSelect={onSelect}
      />
    );
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeSelected();
    fireEvent.press(screen.getByRole('radio', { name: 'No' }));
    expect(onSelect).toHaveBeenCalledWith(false);
  });
});
