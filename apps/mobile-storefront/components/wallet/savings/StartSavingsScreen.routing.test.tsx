import { render, screen } from '@testing-library/react-native';
import { Text as MockText } from 'react-native';
import { StartSavingsScreen } from './StartSavingsScreen';

jest.mock('@/lib/customer-savings-draft-runtime', () => ({
  isCustomerSavingsDraftRuntimeEnabled: () => true,
}));
jest.mock('./LegacyStartSavingsScreen', () => ({
  LegacyStartSavingsScreen: () => <MockText>Full savings creation</MockText>,
}));
jest.mock('./LocalSavingsDraftScreen', () => ({
  LocalSavingsDraftScreen: () => <MockText>Old draft flow</MockText>,
}));
jest.mock('./PiggyvestSavingsScreen', () => ({
  PiggyvestSavingsScreen: () => <MockText>Explicit provider harness</MockText>,
}));

it('opens full savings creation even when the old draft runtime is enabled', () => {
  render(<StartSavingsScreen />);
  expect(screen.getByText('Full savings creation')).toBeOnTheScreen();
  expect(screen.queryByText('Old draft flow')).toBeNull();
});

it('keeps explicitly requested provider harness isolated from normal creation', () => {
  render(<StartSavingsScreen staging={null} />);
  expect(screen.getByText('Explicit provider harness')).toBeOnTheScreen();
  expect(screen.queryByText('Full savings creation')).toBeNull();
});
