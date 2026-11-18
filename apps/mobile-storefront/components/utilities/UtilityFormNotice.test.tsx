import { fireEvent, render, screen } from '@testing-library/react-native';
import { UtilityFormNotice } from './UtilityFormNotice';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

describe('UtilityFormNotice', () => {
  it('shows the message without a link', () => {
    render(<UtilityFormNotice message="Choose a data bundle." />);

    expect(screen.getByText('Choose a data bundle.')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('runs its link when pressed', () => {
    const onPress = jest.fn();
    render(
      <UtilityFormNotice
        action={{ label: 'Add store credit', onPress }}
        message="Not enough store credit to pay this."
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add store credit' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
