import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { OxygenBankPicker } from './OxygenBankPicker';

it('keeps banks compact until opened, then supports alphabetic search and selection', () => {
  const onChange = jest.fn();
  render(
    <OxygenBankPicker
      banks={[
        { code: '002', name: 'Wema Bank' },
        { code: '001', name: 'Access Bank' },
      ]}
      onChange={onChange}
    />
  );
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.press(screen.getByRole('combobox', { name: 'Select bank' }));
  expect(
    screen.getAllByRole('radio').map((node) => node.props.accessibilityLabel)
  ).toEqual(['Access Bank', 'Wema Bank']);
  fireEvent.changeText(screen.getByLabelText('Search banks'), 'wema');
  expect(screen.queryByRole('radio', { name: 'Access Bank' })).toBeNull();
  fireEvent.press(screen.getByRole('radio', { name: 'Wema Bank' }));
  expect(onChange).toHaveBeenCalledWith('002');
  expect(screen.queryByLabelText('Search banks')).toBeNull();
});

it('keeps the trigger and searchable dropdown inside one bordered block', () => {
  render(
    <OxygenBankPicker
      banks={[{ code: '058', name: 'GT Bank' }]}
      onChange={jest.fn()}
    />
  );
  const trigger = screen.getByRole('combobox', { name: 'Select bank' });
  fireEvent.press(trigger);
  let block = trigger.parent;
  while (block && StyleSheet.flatten(block.props.style)?.overflow !== 'hidden')
    block = block.parent;
  expect(StyleSheet.flatten(block?.props.style)).toMatchObject({
    borderWidth: 1,
    borderColor: BRAND.primary,
    borderRadius: 14,
    overflow: 'hidden',
  });
  expect(
    block?.findAll((node) => node.props.accessibilityLabel === 'Search banks')
      .length
  ).toBeGreaterThan(0);
  expect(screen.getByRole('radio', { name: 'GT Bank' })).toBeTruthy();
});
