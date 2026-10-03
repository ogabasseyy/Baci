import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import AppKeyboardDock from './AppKeyboardDock';

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: require('react-native').View,
}));

it('keeps one input surface mounted and rests at the bottom when the keyboard is closed', () => {
  const view = render(
    <AppKeyboardDock availableHeight={700}>
      <Text>Search field</Text>
    </AppKeyboardDock>
  );
  expect(screen.getAllByText('Search field')).toHaveLength(1);
  expect(screen.getByTestId('keyboard-dock')).toHaveProp('offset', {
    closed: 628,
    opened: 628,
  });
  view.rerender(
    <AppKeyboardDock availableHeight={600}>
      <Text>Search field</Text>
    </AppKeyboardDock>
  );
  expect(screen.getAllByText('Search field')).toHaveLength(1);
  expect(screen.getByTestId('keyboard-dock-space')).toHaveStyle({
    position: 'absolute',
    bottom: 0,
  });
});
