import { render, screen } from '@testing-library/react-native';
import { useContext } from 'react';
import { Text } from 'react-native';
import { SavingsSheetContext } from './SavingsSheetContext';

it('defaults to the regular non-sheet context while the server keeps savings off', () => {
  function ContextValue() {
    return <Text>{String(useContext(SavingsSheetContext))}</Text>;
  }

  render(<ContextValue />);
  expect(screen.getByText('false')).toBeOnTheScreen();
});
