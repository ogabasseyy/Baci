import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ImeiCheckScreenHeader } from './imei-check-screen-header';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-router', () => {
  const { View } = jest.requireActual('react-native');
  return {
    router: { back: jest.fn() },
    Stack: {
      Screen: ({
        options,
      }: {
        options: { title: string; headerLeft: () => unknown };
      }) => (
        <View accessibilityLabel={options.title}>
          {options.headerLeft() as never}
        </View>
      ),
    },
  };
});

describe('ImeiCheckScreenHeader', () => {
  it('titles the screen and goes back', () => {
    render(<ImeiCheckScreenHeader textColor="#000" />);
    expect(screen.getByLabelText('IMEI Checker')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});
