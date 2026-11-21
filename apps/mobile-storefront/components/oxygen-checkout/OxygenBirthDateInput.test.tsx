import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { OxygenBirthDateInput } from './OxygenBirthDateInput';

it('keeps both separators and the remaining template visible during partial entry', () => {
  const onChangeText = jest.fn();
  render(
    <OxygenBirthDateInput
      value="1"
      onChangeText={onChangeText}
      onBlur={jest.fn()}
    />
  );
  expect(
    screen.getAllByText('/', { includeHiddenElements: true })
  ).toHaveLength(2);
  for (const separator of screen.getAllByText('/', {
    includeHiddenElements: true,
  }))
    expect(separator).toHaveStyle({ color: Colors.light.placeholder });
  expect(screen.getByText('1', { includeHiddenElements: true })).toHaveStyle({
    color: Colors.light.text,
  });
  expect(screen.getByText('D', { includeHiddenElements: true })).toHaveStyle({
    color: Colors.light.placeholder,
  });
  fireEvent.changeText(screen.getByLabelText('Type date of birth'), '12');
  expect(onChangeText).toHaveBeenCalledWith('12');
});

it('brightens separators for a complete date without duplicating entered digits', () => {
  render(
    <OxygenBirthDateInput
      value="29/02/1992"
      onChangeText={jest.fn()}
      onBlur={jest.fn()}
    />
  );
  expect(screen.getByDisplayValue('29/02/1992')).toBeTruthy();
  for (const separator of screen.getAllByText('/', {
    includeHiddenElements: true,
  }))
    expect(separator).toHaveStyle({ color: Colors.light.text });
  expect(screen.queryByText('D', { includeHiddenElements: true })).toBeNull();
});

it('brightens the first slash when the day is complete, and the second when the month is complete', () => {
  const { rerender } = render(
    <OxygenBirthDateInput
      value="12"
      onChangeText={jest.fn()}
      onBlur={jest.fn()}
    />
  );
  const hidden = { includeHiddenElements: true };
  expect(screen.getAllByText('/', hidden)[0]).toHaveStyle({
    color: Colors.light.text,
  });
  expect(screen.getAllByText('/', hidden)[1]).toHaveStyle({
    color: Colors.light.placeholder,
  });
  rerender(
    <OxygenBirthDateInput
      value="12/05"
      onChangeText={jest.fn()}
      onBlur={jest.fn()}
    />
  );
  for (const slash of screen.getAllByText('/', hidden))
    expect(slash).toHaveStyle({ color: Colors.light.text });
});
