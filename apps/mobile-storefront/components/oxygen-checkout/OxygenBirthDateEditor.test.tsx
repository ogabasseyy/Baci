import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenBirthDateEditor } from './OxygenBirthDateEditor';

it('keeps partial typing local so the calendar is not updated per keystroke', () => {
  const onDateChange = jest.fn();
  render(<OxygenBirthDateEditor onDateChange={onDateChange} />);
  for (const text of ['1', '12', '12/0', '12/05', '12/05/1', '12/05/199']) {
    fireEvent.changeText(screen.getByLabelText('Type date of birth'), text);
  }
  expect(onDateChange).not.toHaveBeenCalled();
  fireEvent.changeText(
    screen.getByLabelText('Type date of birth'),
    '12/05/1990'
  );
  expect(onDateChange).toHaveBeenCalledTimes(1);
  expect(onDateChange).toHaveBeenCalledWith('1990-05-12');
});

it('clears validity once without erasing partial typing when the parent acknowledges it', () => {
  const onDateChange = jest.fn();
  const { rerender } = render(
    <OxygenBirthDateEditor value="1990-05-12" onDateChange={onDateChange} />
  );
  fireEvent.changeText(
    screen.getByLabelText('Type date of birth'),
    '12/05/199'
  );
  expect(onDateChange).toHaveBeenCalledWith(undefined);
  rerender(<OxygenBirthDateEditor onDateChange={onDateChange} />);
  expect(screen.getByDisplayValue('12/05/199')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Type date of birth'), '12/05/19');
  expect(onDateChange).toHaveBeenCalledTimes(1);
  rerender(
    <OxygenBirthDateEditor value="1992-02-29" onDateChange={onDateChange} />
  );
  expect(screen.getByDisplayValue('29/02/1992')).toBeTruthy();
});
