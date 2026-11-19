import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckTop } from './imei-check-top';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('ImeiCheckTop', () => {
  it('shows the hero and switches device from the tabs', () => {
    const onSelect = jest.fn();
    render(
      <ImeiCheckTop
        colors={Colors.light}
        selected="smartphone"
        onSelect={onSelect}
      />
    );
    expect(screen.getByText('Device verification')).toBeOnTheScreen();
    expect(screen.getByLabelText('Phone checks')).toHaveAccessibilityState({
      selected: true,
    });
    fireEvent.press(screen.getByLabelText('Mac checks'));
    expect(onSelect).toHaveBeenCalledWith('laptop');
  });
});
