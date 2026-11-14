import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { GoalCancelButton } from './GoalCancelStepParts';

describe('cancel step parts with the server off', () => {
  it('a button only runs its own action', () => {
    const onPress = jest.fn();
    render(
      <GoalCancelButton
        colors={Colors.dark}
        label="Keep saving"
        onPress={onPress}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Keep saving' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
