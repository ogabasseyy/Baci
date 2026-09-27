import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { EliteSlide } from './EliteSlide';
import type { HeroThemeColors, HeroVariantStyles } from './HeroSlideShared';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const item = {
  ctaLink: '/deals/elite',
  ctaText: 'Shop elite',
  image: 'https://example.com/elite.jpg',
  subtitle: 'Members-only prices',
  title: 'Elite deals',
};

const props = {
  colors: {} as unknown as HeroThemeColors,
  isDark: false,
  item,
  screenWidth: 390,
  styles: {} as unknown as HeroVariantStyles,
};

describe('EliteSlide', () => {
  it('renders the title, subtitle, and CTA', () => {
    // Arrange & Act
    render(<EliteSlide {...props} />);

    // Assert
    expect(screen.getByText('Elite deals')).toBeTruthy();
    expect(screen.getByText('Members-only prices')).toBeTruthy();
    expect(screen.getByText('Shop elite')).toBeTruthy();
  });

  it('navigates to the CTA link on press', () => {
    // Arrange
    render(<EliteSlide {...props} />);

    // Act
    fireEvent.press(screen.getByLabelText('Shop elite'));

    // Assert
    expect(mockPush).toHaveBeenCalledWith('/deals/elite');
  });
});
