import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useQuizStore } from '@/stores/quiz-store';
import { QuizRouteBackButton } from './QuizRouteBackButton';

const mockRouterBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockRouterBack }),
}));

describe('QuizRouteBackButton', () => {
  beforeEach(() => {
    mockRouterBack.mockClear();
    useQuizStore.getState().reset();
  });

  it('delegates result dismissal without clearing recovery or bypassing its exit policy', () => {
    useQuizStore.setState({ status: 'result' });
    const onBack = jest.fn();
    render(<QuizRouteBackButton color="#ffffff" onBack={onBack} />);

    fireEvent.press(screen.getByRole('button', { name: 'Back to SuperQuiz' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(useQuizStore.getState().status).toBe('result');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('uses normal route navigation when already on the SuperQuiz lobby', () => {
    useQuizStore.setState({ status: 'ready' });
    render(<QuizRouteBackButton color="#ffffff" onBack={mockRouterBack} />);

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
