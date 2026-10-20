import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SearchComparisonSession } from './SearchComparisonSession';
import { useSearchComparisonIntent } from './useSearchComparisonIntent';

function Probe() {
  const intent = useSearchComparisonIntent();
  return (
    <Text testID="intent-state" onPress={() => intent.activate()}>
      {intent.active ? 'active' : 'idle'}
    </Text>
  );
}

describe('useSearchComparisonIntent', () => {
  it('stays idle outside a session', () => {
    render(<Probe />);
    expect(screen.getByTestId('intent-state').props.children).toBe('idle');
    fireEvent.press(screen.getByTestId('intent-state'));
    expect(screen.getByTestId('intent-state').props.children).toBe('idle');
  });

  it('activates within a session', () => {
    render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    fireEvent.press(screen.getByTestId('intent-state'));
    expect(screen.getByTestId('intent-state').props.children).toBe('active');
  });
});
