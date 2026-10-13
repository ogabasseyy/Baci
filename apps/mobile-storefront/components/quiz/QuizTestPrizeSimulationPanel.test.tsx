import { fireEvent, render, screen } from '@testing-library/react-native';
import { createQuizStyles } from './QuizScreen.styles';
import { QuizTestPrizeSimulationPanel } from './QuizTestPrizeSimulationPanel';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const styles = createQuizStyles({
  background: '#000',
  border: '#222',
  card: '#111',
  error: '#f00',
  muted: '#555',
  primary: '#f90',
  primaryLowOpacity: '#321',
  primaryForeground: '#000',
  success: '#0f8',
  text: '#fff',
  textSecondary: '#aaa',
  warning: '#fb0',
});

describe('QuizTestPrizeSimulationPanel', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('opens a display-only checkout with the selected test prize', () => {
    render(
      <QuizTestPrizeSimulationPanel
        prize={{
          condition: 'used',
          id: 'product-1',
          imageUrl: 'https://example.com/iphone.jpg',
          name: 'iPhone XR',
          variantId: 'variant-1',
        }}
        styles={styles}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Redeem prize' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/quiz/prize-checkout-simulation',
      params: expect.objectContaining({
        name: 'iPhone XR',
        productId: 'product-1',
        variantId: 'variant-1',
      }),
    });
  });

  it('uses empty route values when optional prize fields are unavailable', () => {
    render(
      <QuizTestPrizeSimulationPanel
        prize={{
          condition: null,
          id: 'product-2',
          imageUrl: null,
          name: 'Mystery phone',
          variantId: null,
        }}
        styles={styles}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Redeem prize' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/quiz/prize-checkout-simulation',
      params: {
        condition: '',
        imageUrl: '',
        name: 'Mystery phone',
        productId: 'product-2',
        variantId: '',
      },
    });
  });
});
