import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextDropHeroSlide } from './NextDropHeroSlide';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

it('keeps the existing wallet destination and hides the preview provider without a live verdict', () => {
  const originalDev = globalThis.__DEV__;
  globalThis.__DEV__ = false;
  try {
    render(
      <NextDropHeroSlide
        width={390}
        height={220}
        artwork={{ uri: 'https://example.test/savings.webp' }}
        title="Save for your device"
        subtitle="Earn Interest"
        ctaText="Explore savings"
        ctaLink="/wallet"
        showSavingsProvider
      />
    );
    expect(screen.queryByLabelText(/powered by piggyvest/i)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Explore savings' }));
    expect(mockPush).toHaveBeenCalledWith('/wallet');
  } finally {
    globalThis.__DEV__ = originalDev;
  }
});
