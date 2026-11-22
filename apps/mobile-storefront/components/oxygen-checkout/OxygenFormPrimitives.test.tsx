import {
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { withAlpha } from '@/constants/palette';
import { OxygenDraftSaveContext } from './OxygenDraftSaveContext';
import { OxygenField, useOxygenColors } from './OxygenFormPrimitives';

jest.mock('@/components/useColorScheme', () => ({ useColorScheme: jest.fn() }));

it.each([
  'light',
  'dark',
] as const)('preserves %s mode surfaces and uses red Oxygen actions', (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const { result } = renderHook(() => useOxygenColors());
  expect(result.current.background).toBe(Colors[scheme].background);
  expect(result.current.text).toBe(Colors[scheme].text);
  expect(result.current.primary).toBe(BRAND.primary);
  expect(result.current.primaryForeground).toBe(BRAND.onPrimary);
  expect(result.current.primaryLowOpacity).toBe(
    withAlpha(BRAND.primary, scheme === 'dark' ? 0.14 : 0.08)
  );
});

it.each([
  'BVN',
  'NIN',
])('can reveal and re-hide %s without changing the value', (label) => {
  const onChange = jest.fn();
  render(
    <OxygenField
      label={label}
      value="12345678901"
      onChange={onChange}
      secureTextEntry
    />
  );
  expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: `Show ${label}` }));
  expect(screen.getByLabelText(label).props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText(label).props.value).toBe('12345678901');
  fireEvent.press(screen.getByRole('button', { name: `Hide ${label}` }));
  expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it('does not add a reveal action to ordinary contact fields', () => {
  render(<OxygenField label="First name" value="Test" onChange={jest.fn()} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('requests persistence on blur without saving individual keystrokes', () => {
  const save = jest.fn();
  render(
    <OxygenDraftSaveContext value={save}>
      <OxygenField label="BVN" onChange={jest.fn()} secureTextEntry />
    </OxygenDraftSaveContext>
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '123');
  expect(save).not.toHaveBeenCalled();
  fireEvent(screen.getByLabelText('BVN'), 'blur');
  expect(save).toHaveBeenCalledTimes(1);
});
