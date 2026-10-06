import { expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StartSavingsScreen } from './StartSavingsScreen';

const mockLegacy = jest.fn(() => ({ isRefetching: false, refetch: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockLegacy(),
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));
it('does not mount legacy funding when staging is explicitly present but undefined', () => {
  const view = render(<StartSavingsScreen staging={undefined} />);
  expect(mockLegacy).not.toHaveBeenCalled();
  expect(screen.getByText('Draft review is unavailable.')).toBeOnTheScreen();
  view.rerender(<StartSavingsScreen />);
  expect(mockLegacy).toHaveBeenCalledTimes(1);
});
