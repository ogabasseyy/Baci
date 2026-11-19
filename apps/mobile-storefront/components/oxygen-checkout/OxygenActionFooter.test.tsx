import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import {
  OxygenActionFooter,
  OxygenActionFooterProvider,
  OxygenFooterVisibility,
} from './OxygenActionFooter';
import { OxygenButton } from './OxygenFormPrimitives';

function Page({ visible = true, disabled = false, onPress = jest.fn() }) {
  return (
    <OxygenActionFooterProvider>
      <ScrollView accessibilityLabel="Scrollable choices">
        <Text>Choose your plan</Text>
        <OxygenFooterVisibility value={visible}>
          <OxygenActionFooter>
            <OxygenButton
              title="Continue"
              disabled={disabled}
              onPress={onPress}
            />
          </OxygenActionFooter>
        </OxygenFooterVisibility>
      </ScrollView>
    </OxygenActionFooterProvider>
  );
}
it('keeps exactly one action outside the scrolling content and updates its current handler', () => {
  const first = jest.fn();
  const next = jest.fn();
  const { rerender } = render(<Page onPress={first} />);
  const keyboard = within(screen.getByTestId('keyboard-container'));
  expect(keyboard.getByLabelText('Scrollable choices')).toBeTruthy();
  expect(keyboard.getByRole('button', { name: 'Continue' })).toBeTruthy();
  expect(
    within(screen.getByLabelText('Scrollable choices')).queryByRole('button')
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(first).toHaveBeenCalledTimes(1);
  rerender(<Page onPress={next} />);
  expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(next).toHaveBeenCalledTimes(1);
  rerender(<Page onPress={next} disabled />);
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(next).toHaveBeenCalledTimes(1);
});
it('removes the action while the source step is hidden during a completion transition', () => {
  const { rerender } = render(<Page />);
  rerender(<Page visible={false} />);
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  rerender(<Page />);
  expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
});

it('does not let cleanup from a hidden action erase the replacement recovery action', () => {
  function Transition({ failed }: { failed: boolean }) {
    return (
      <OxygenActionFooterProvider>
        <ScrollView>
          {failed ? (
            <OxygenActionFooter>
              <OxygenButton title="Check for an update" onPress={jest.fn()} />
            </OxygenActionFooter>
          ) : null}
          <OxygenFooterVisibility value={!failed}>
            <OxygenActionFooter>
              <OxygenButton title="See payment breakdown" onPress={jest.fn()} />
            </OxygenActionFooter>
          </OxygenFooterVisibility>
        </ScrollView>
      </OxygenActionFooterProvider>
    );
  }
  const { rerender } = render(<Transition failed={false} />);
  rerender(<Transition failed />);
  expect(
    screen.getAllByRole('button', { name: 'Check for an update' })
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: 'See payment breakdown' })
  ).toBeNull();
});
