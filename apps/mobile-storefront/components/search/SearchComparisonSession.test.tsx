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

describe('SearchComparisonSession', () => {
  it('starts idle and activates on demand', () => {
    render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    expect(screen.getByTestId('intent-state').props.children).toBe('idle');
    fireEvent.press(screen.getByTestId('intent-state'));
    expect(screen.getByTestId('intent-state').props.children).toBe('active');
  });
  it('resets the intent when the search scope changes', () => {
    const view = render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    fireEvent.press(screen.getByTestId('intent-state'));
    expect(screen.getByTestId('intent-state').props.children).toBe('active');
    view.rerender(
      <SearchComparisonSession scope="laptop">
        <Probe />
      </SearchComparisonSession>
    );
    expect(screen.getByTestId('intent-state').props.children).toBe('idle');
  });
});
