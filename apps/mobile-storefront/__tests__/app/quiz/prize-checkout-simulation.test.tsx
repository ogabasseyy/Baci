import { render, screen } from '@testing-library/react-native';
import QuizPrizeCheckoutSimulationRoute from '@/app/quiz/prize-checkout-simulation';

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));
jest.mock('@/components/quiz/QuizPrizeCheckoutSimulationScreen', () => ({
  QuizPrizeCheckoutSimulationScreen: ({
    prize,
  }: {
    prize: { condition: string | null; id: string; name: string };
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(
      Text,
      null,
      `${prize.id}: ${prize.name}: ${String(prize.condition)}`
    );
  },
}));

describe('QuizPrizeCheckoutSimulationRoute', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({
      condition: 'used',
      name: 'iPhone XR',
      productId: 'product-1',
    });
  });

  it('passes the selected test prize into the simulation screen', () => {
    render(<QuizPrizeCheckoutSimulationRoute />);
    expect(screen.getByText('product-1: iPhone XR: used')).toBeOnTheScreen();
    expect(screen.getByTestId('quiz-prize-checkout-shell').props.edges).toEqual(
      {
        bottom: 'off',
        left: 'off',
        right: 'off',
        top: 'off',
      }
    );
  });

  it('uses documented fallback values when optional route params are absent', () => {
    mockUseLocalSearchParams.mockReturnValue({});

    render(<QuizPrizeCheckoutSimulationRoute />);

    expect(screen.getByText('test-prize: Quiz prize: null')).toBeOnTheScreen();
  });
});
