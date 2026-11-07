import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { GoalLifecycleAction } from './GoalLifecycleAction';

it('keeps a busy savings action disabled and does not invoke its callback', () => {
  const onPress = jest.fn();
  render(
    <GoalLifecycleAction
      colors={Colors.light}
      label="Continue"
      onPress={onPress}
      busy
    />
  );
  const action = screen.getByRole('button', { name: 'Continue' });
  expect(action).toBeDisabled();
  expect(action).toBeBusy();
  fireEvent.press(action);
  expect(onPress).not.toHaveBeenCalled();
});

it('invokes only the supplied action when enabled', () => {
  const onPress = jest.fn();
  render(
    <GoalLifecycleAction
      colors={Colors.dark}
      label="Try again"
      onPress={onPress}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});
