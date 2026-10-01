import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';
import { QuizPrizeCheckoutSimulationScreen } from './QuizPrizeCheckoutSimulationScreen';

const mockBack = jest.fn();
const mockDismissRecovery = jest.fn();
const mockResetQuiz = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/stores/quiz-store', () => ({
  useQuizStore: (selector: (state: unknown) => unknown) =>
    selector({
      dismissRecovery: mockDismissRecovery,
      reset: mockResetQuiz,
    }),
}));
jest.mock('@/components/checkout/CheckoutScreenView', () => ({
  CheckoutScreenView: ({
    prizeSimulation,
  }: {
    prizeSimulation: {
      item: { name: string; price: number };
      onComplete: () => void;
    };
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Pressable, Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return (
      <React.Fragment>
        <Text>{`${prizeSimulation.item.name}: ${prizeSimulation.item.price}`}</Text>
        <Pressable
          accessibilityLabel="Complete simulation"
          accessibilityRole="button"
          onPress={prizeSimulation.onComplete}
        >
          <Text>Complete</Text>
        </Pressable>
      </React.Fragment>
    );
  },
}));

describe('QuizPrizeCheckoutSimulationScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockDismissRecovery.mockClear();
    mockResetQuiz.mockClear();
  });

  it('prices the test prize at zero and ends on a non-mutating confirmation', () => {
    render(
      <QuizPrizeCheckoutSimulationScreen
        prize={{
          condition: 'used',
          id: 'product-1',
          imageUrl: null,
          name: 'iPhone XR',
          variantId: null,
        }}
      />
    );

    expect(screen.getByText('iPhone XR: 0')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Complete simulation' })
    );

    expect(screen.getByText('Prize checkout confirmed')).toBeOnTheScreen();
    expect(
      screen.getByText(/created no order, charged no payment/)
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Back to quizzes' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('clears the quiz before Android back leaves the completed simulation', () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    const addEventListener = jest.spyOn(BackHandler, 'addEventListener');
    const remove = jest.fn();
    addEventListener.mockReturnValue({ remove } as ReturnType<
      typeof BackHandler.addEventListener
    >);

    try {
      render(
        <QuizPrizeCheckoutSimulationScreen
          prize={{
            condition: 'used',
            id: 'product-1',
            imageUrl: null,
            name: 'iPhone XR',
            variantId: null,
          }}
        />
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Complete simulation' })
      );

      const onBack = addEventListener.mock.calls[0]?.[1];
      expect(onBack).toBeDefined();
      act(() => {
        expect(
          onBack?.({ type: 'hardwareBackPress', timeStamp: Date.now() })
        ).toBe(true);
      });
      expect(mockDismissRecovery).toHaveBeenCalledTimes(1);
      expect(mockResetQuiz).toHaveBeenCalledTimes(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatform,
      });
    }
  });
});
