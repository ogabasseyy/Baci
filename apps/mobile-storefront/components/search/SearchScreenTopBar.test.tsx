import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SearchScreenTopBar } from './SearchScreenTopBar';

jest.mock('./SearchShoppingActions', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    SearchShoppingActions: ({
      showComparison,
    }: {
      showComparison: boolean;
    }) => <View testID={showComparison ? 'comparison-on' : 'comparison-off'} />,
  };
});

describe('SearchScreenTopBar', () => {
  it('goes back and gates the comparison action on results', () => {
    const onBack = jest.fn();
    const view = render(
      <SearchScreenTopBar
        colors={Colors.light}
        onBack={onBack}
        showComparison
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('comparison-on')).toBeTruthy();
    view.rerender(
      <SearchScreenTopBar
        colors={Colors.light}
        onBack={onBack}
        showComparison={false}
      />
    );
    expect(screen.getByTestId('comparison-off')).toBeTruthy();
  });
});
