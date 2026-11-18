import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextDropHeroSlide } from './NextDropHeroSlide';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

it('opens the campaign destination from its action', () => {
  render(
    <NextDropHeroSlide
      width={390}
      height={220}
      artwork={{ uri: 'https://example.com/hero.webp' }}
      title="Save for your device"
      subtitle="Earn Interest"
      ctaText="Explore savings"
      ctaLink="/wallet"
    />
  );
  fireEvent.press(screen.getByText('Explore savings'));
  expect(mockPush).toHaveBeenCalledWith('/wallet');
});
