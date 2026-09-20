import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FashionSlide } from './FashionSlide';
import type { HeroVariantStyles } from './HeroSlideShared';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const props = {
  item: {
    ctaLink: '/deals/fashion',
    ctaText: 'Shop fashion',
    image: 'https://example.com/fashion.jpg',
    subtitle: 'New season looks',
    title: 'Fashion week',
  },
  screenWidth: 390,
  styles: {} as unknown as HeroVariantStyles,
};

describe('FashionSlide', () => {
  it('renders the title and CTA', () => {
    // Arrange & Act
    render(<FashionSlide {...props} />);

    // Assert
    expect(screen.getByText('Fashion week')).toBeTruthy();
    expect(screen.getByText(/Shop fashion/)).toBeTruthy();
  });

  it('navigates to the CTA link on press', () => {
    // Arrange
    render(<FashionSlide {...props} />);

    // Act
    fireEvent.press(screen.getByLabelText('Shop fashion'));

    // Assert
    expect(mockPush).toHaveBeenCalledWith('/deals/fashion');
  });
});
