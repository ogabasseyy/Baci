import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenPlanSlider } from './OxygenPlanSlider';

it('uses the full 0–100 track and clamps movement to approved bounds', () => {
  const onChange = jest.fn();
  render(
    <OxygenPlanSlider
      value={25}
      min={25}
      max={90}
      total={198000}
      disabled={false}
      onChange={onChange}
    />
  );
  const slider = screen.getByRole('adjustable', {
    name: 'Down payment slider',
  });
  fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 320 } } });
  fireEvent(slider, 'responderGrant', { nativeEvent: { locationX: 240 } });
  expect(onChange).toHaveBeenLastCalledWith(75);
  fireEvent(slider, 'responderMove', { nativeEvent: { locationX: 320 } });
  expect(onChange).toHaveBeenLastCalledWith(90);
  fireEvent(slider, 'responderMove', { nativeEvent: { locationX: 0 } });
  expect(onChange).toHaveBeenLastCalledWith(25);
});
it('does not change the selection while submission is busy', () => {
  const onChange = jest.fn();
  render(
    <OxygenPlanSlider
      value={25}
      min={25}
      max={90}
      total={198000}
      disabled
      onChange={onChange}
    />
  );
  const slider = screen.getByRole('adjustable', {
    name: 'Down payment slider',
  });
  fireEvent(slider, 'responderMove', { nativeEvent: { locationX: 200 } });
  fireEvent(slider, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(onChange).not.toHaveBeenCalled();
});

it('tracks screen movement when the native event target changes beneath the thumb', () => {
  const onChange = jest.fn();
  render(
    <OxygenPlanSlider
      value={50}
      min={25}
      max={90}
      total={198000}
      disabled={false}
      onChange={onChange}
    />
  );
  const slider = screen.getByRole('adjustable', {
    name: 'Down payment slider',
  });
  fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 320 } } });
  fireEvent(slider, 'responderGrant', {
    nativeEvent: { locationX: 160, pageX: 200 },
  });
  fireEvent(slider, 'responderMove', {
    nativeEvent: { locationX: 0, pageX: 168 },
  });
  expect(onChange).toHaveBeenLastCalledWith(40);
  fireEvent(slider, 'responderRelease', {
    nativeEvent: { locationX: 0, pageX: 152 },
  });
  expect(onChange).toHaveBeenLastCalledWith(35);
});

it('keeps accessibility increments at two decimal places', () => {
  const onChange = jest.fn();
  render(
    <OxygenPlanSlider
      value={31.01}
      min={31.01}
      max={75}
      total={100000}
      disabled={false}
      onChange={onChange}
    />
  );
  fireEvent(screen.getByRole('adjustable'), 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(onChange).toHaveBeenCalledWith(32.01);
});
