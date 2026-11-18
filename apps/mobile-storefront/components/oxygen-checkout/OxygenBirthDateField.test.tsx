import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenBirthDateField } from './OxygenBirthDateField';

let mockAnimationType: string | undefined;
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    children,
    animationType,
  }: {
    children: React.ReactNode;
    animationType?: string;
  }) => {
    mockAnimationType = animationType;
    return children;
  },
}));

it('selects a leap-day birth date through year and month choices, committing only on confirmation', () => {
  const onChange = jest.fn();
  render(<OxygenBirthDateField value="1990-06-15" onChange={onChange} />);
  expect(screen.getByText('15 June 1990')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  fireEvent.press(screen.getByRole('button', { name: 'Choose birth year' }));
  fireEvent.press(screen.getByRole('button', { name: '1992' }));
  fireEvent.press(screen.getByRole('button', { name: 'February' }));
  fireEvent.press(screen.getByRole('button', { name: '29 February 1992' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Use this date' }));
  expect(onChange).toHaveBeenCalledWith('1992-02-29');
  expect(
    screen.queryByText('Choose the date on your identity records.')
  ).toBeNull();
});

it('discards a changed selection when closed', () => {
  const onChange = jest.fn();
  render(<OxygenBirthDateField value="1990-06-15" onChange={onChange} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  fireEvent.press(screen.getByRole('button', { name: '16 June 1990' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Close date of birth calendar' })
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('15 June 1990')).toBeTruthy();
});

it('blocks future dates and navigation', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, 12));
  render(<OxygenBirthDateField value="2026-11-05" onChange={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  expect(
    screen.getByRole('button', { name: 'Next calendar page' })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: '6 November 2026' })
  ).toBeDisabled();
  jest.useRealTimers();
});

it('cannot open while submitting', () => {
  render(<OxygenBirthDateField onChange={jest.fn()} disabled />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  expect(
    screen.queryByText('Choose the date on your identity records.')
  ).toBeNull();
});

it('does not preselect a date for an empty field', () => {
  render(<OxygenBirthDateField onChange={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  expect(screen.getByRole('button', { name: 'Use this date' })).toBeDisabled();
});

it('accepts a typed date, synchronizes the calendar and waits for confirmation', () => {
  const onChange = jest.fn();
  render(<OxygenBirthDateField onChange={onChange} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  fireEvent.changeText(screen.getByLabelText('Type date of birth'), '29021992');
  expect(screen.getByDisplayValue('29/02/1992')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '29 February 1992' })
  ).toHaveAccessibilityState({ selected: true });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Use this date' }));
  expect(onChange).toHaveBeenCalledWith('1992-02-29');
});

it('invalid or incomplete typing clears an earlier valid selection', () => {
  render(<OxygenBirthDateField value="1990-06-15" onChange={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  for (const date of ['31/02/1990', '01/01/2999', '12/']) {
    fireEvent.changeText(screen.getByLabelText('Type date of birth'), date);
    expect(
      screen.getByRole('button', { name: 'Use this date' })
    ).toBeDisabled();
  }
  fireEvent.press(screen.getByRole('button', { name: '16 June 1990' }));
  expect(screen.getByDisplayValue('16/06/1990')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use this date' })).toBeEnabled();
});

it('opens immediately without a sliding modal transition', () => {
  render(<OxygenBirthDateField onChange={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose date of birth' }));
  expect(mockAnimationType).toBe('none');
});
